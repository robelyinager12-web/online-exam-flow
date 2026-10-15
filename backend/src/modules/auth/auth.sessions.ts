import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { authConfig } from '../../config/auth';
import { logger } from '../../config/logger';
import { AppError } from '../../lib/appError';
import { prisma } from '../../lib/prisma';
import { generateToken, hashToken } from '../../lib/tokens';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export type UserWithInstitution = Prisma.UserGetPayload<{
  include: { institution: { select: { isActive: true } } };
}>;

// A password check alone is not enough: the account must also be allowed to sign in.
export function assertAccountUsable(user: UserWithInstitution): void {
  if (user.deletedAt) {
    throw AppError.unauthorized('Invalid session');
  }
  if (user.status === 'PENDING_VERIFICATION') {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in');
  }
  if (user.status !== 'ACTIVE' || (user.institution && !user.institution.isActive)) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Please contact your administrator');
  }
}

export async function createSession(
  userId: string,
  ctx: RequestContext,
  familyId: string = randomUUID(),
): Promise<{ token: string; familyId: string }> {
  const token = generateToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashToken(token),
      userAgent: ctx.userAgent?.slice(0, 255),
      ipAddress: ctx.ipAddress,
      expiresAt: new Date(Date.now() + authConfig.refreshTtlSeconds * 1000),
    },
  });
  return { token, familyId };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Used later by user management (deactivating an account signs the user out everywhere).
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionByToken(rawToken: string): Promise<{ userId: string } | null> {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record) return null;
  await revokeFamily(record.familyId);
  return { userId: record.userId };
}

// Refresh token rotation: every refresh invalidates the old token and issues a new one in the same
// family. If an already-used token shows up again, someone may have stolen it, so the whole
// family (every token of that login) is revoked.
export async function rotateSession(
  rawToken: string,
  ctx: RequestContext,
): Promise<{ user: UserWithInstitution; token: string; familyId: string }> {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: { institution: { select: { isActive: true } } } } },
  });

  if (!record) {
    throw AppError.unauthorized('Invalid session');
  }

  const now = new Date();

  if (record.revokedAt) {
    const secondsSinceRevoked = (now.getTime() - record.revokedAt.getTime()) / 1000;
    if (secondsSinceRevoked <= authConfig.refreshReuseGraceSeconds) {
      // Two requests refreshed at the same moment. Not theft: the client can simply retry.
      throw new AppError(401, 'REFRESH_CONFLICT', 'Session was just refreshed, please retry');
    }
    logger.warn({ userId: record.userId, familyId: record.familyId }, 'Refresh token reuse detected, revoking session family');
    await revokeFamily(record.familyId);
    throw AppError.unauthorized('Session is no longer valid');
  }

  if (record.expiresAt <= now) {
    throw AppError.unauthorized('Session expired');
  }

  assertAccountUsable(record.user);

  // Claim the token atomically: if two requests race, only one can win.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: now, lastUsedAt: now },
  });
  if (claimed.count !== 1) {
    throw new AppError(401, 'REFRESH_CONFLICT', 'Session was just refreshed, please retry');
  }

  const session = await createSession(record.userId, ctx, record.familyId);
  return { user: record.user, token: session.token, familyId: session.familyId };
}