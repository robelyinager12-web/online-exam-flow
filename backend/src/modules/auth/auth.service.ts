import type { User } from '@prisma/client';
import { authConfig } from '../../config/auth';
import { env } from '../../config/env';
import { resetPasswordEmail } from '../../emails/resetPassword';
import { verifyEmailEmail } from '../../emails/verifyEmail';
import { AppError } from '../../lib/appError';
import { signAccessToken } from '../../lib/jwt';
import { sendMailInBackground } from '../../lib/mailer';
import { hashPassword, verifyPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { hashToken } from '../../lib/tokens';
import { recordAudit } from '../audit/audit.service';
import { buildAppLink, issueEmailToken } from './auth.tokens';
import type { LoginInput, RegisterInput } from './auth.validation';
import {
  assertAccountUsable,
  createSession,
  revokeSessionByToken,
  rotateSession,
  type RequestContext,
  type UserWithInstitution,
} from './auth.sessions';

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const invalidToken = () => new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');

export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    institutionId: user.institutionId,
    studentNumber: user.studentNumber,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

// Verifying against a throwaway hash when the email is unknown keeps response time the same,
// so attackers cannot discover which emails are registered.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

// ---------------------------------------------------------------- register

export async function register(input: RegisterInput, ctx: RequestContext): Promise<void> {
  if (!env.ALLOW_SELF_REGISTRATION) {
    throw new AppError(
      403,
      'REGISTRATION_DISABLED',
      'Self-registration is disabled. Please ask your institution administrator to create your account.',
    );
  }

  const institution = await prisma.institution.findUnique({ where: { slug: input.institutionSlug } });
  if (!institution || !institution.isActive) {
    throw AppError.notFound('Institution not found');
  }

  // Hash first, then look up, so a duplicate email costs the same time as a new one.
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    // Same response as a successful registration: the email is not revealed.
    return;
  }

  if (input.studentNumber) {
    const taken = await prisma.user.findFirst({
      where: { institutionId: institution.id, studentNumber: input.studentNumber },
      select: { id: true },
    });
    if (taken) {
      throw AppError.conflict('This student number is already registered');
    }
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        institutionId: institution.id,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        studentNumber: input.studentNumber,
        role: 'STUDENT',
        status: 'PENDING_VERIFICATION',
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }

  const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', authConfig.verifyTokenTtlMs);
  if (token) {
    sendMailInBackground({
      to: user.email,
      ...verifyEmailEmail({ firstName: user.firstName, url: buildAppLink('/verify-email', token) }),
    });
  }

  await recordAudit({
    actorId: user.id,
    institutionId: institution.id,
    action: 'auth.register',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

// ------------------------------------------------------------------- login

export async function login(input: LoginInput, ctx: RequestContext) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { institution: { select: { isActive: true } } },
  });

  if (!user || user.deletedAt) {
    await verifyPassword(await getDummyHash(), input.password);
    await recordAudit({
      action: 'auth.login_failed',
      entityType: 'user',
      metadata: { email: input.email, reason: 'unknown_account' },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Please try again in a few minutes.');
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  if (!passwordMatches) {
    await registerFailedLogin(user, ctx);
    throw invalidCredentials();
  }

  // Status is checked only after the password is correct, so it is never revealed to guessers.
  assertAccountUsable(user);

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const session = await createSession(user.id, ctx);
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    institutionId: user.institutionId,
    sessionId: session.familyId,
  });

  await recordAudit({
    actorId: user.id,
    institutionId: user.institutionId,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { user: toPublicUser(user), accessToken, refreshToken: session.token };
}

async function registerFailedLogin(user: UserWithInstitution, ctx: RequestContext): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  const locked = updated.failedLoginCount >= authConfig.maxFailedLogins;
  if (locked) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: new Date(Date.now() + authConfig.lockMinutes * 60 * 1000),
      },
    });
  }

  await recordAudit({
    actorId: user.id,
    institutionId: user.institutionId,
    action: locked ? 'auth.account_locked' : 'auth.login_failed',
    entityType: 'user',
    entityId: user.id,
    metadata: { reason: 'wrong_password' },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

// ----------------------------------------------------------------- refresh

export async function refresh(rawRefreshToken: string, ctx: RequestContext) {
  const { user, token, familyId } = await rotateSession(rawRefreshToken, ctx);
  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    institutionId: user.institutionId,
    sessionId: familyId,
  });
  return { user: toPublicUser(user), accessToken, refreshToken: token };
}

// ------------------------------------------------------------------ logout

export async function logout(rawRefreshToken: string | undefined, ctx: RequestContext): Promise<void> {
  if (!rawRefreshToken) return;
  const revoked = await revokeSessionByToken(rawRefreshToken);
  if (revoked) {
    await recordAudit({
      actorId: revoked.userId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: revoked.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}

// ----------------------------------------------------------------- profile

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { institution: { select: { id: true, name: true, slug: true, isActive: true } } },
  });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Invalid session');
  }
  return {
    ...toPublicUser(user),
    institution: user.institution
      ? { id: user.institution.id, name: user.institution.name, slug: user.institution.slug }
      : null,
  };
}

// ---------------------------------------------------------- email verification

export async function verifyEmail(rawToken: string, ctx: RequestContext): Promise<void> {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  const now = new Date();
  if (!record || record.type !== 'VERIFY_EMAIL' || record.usedAt || record.expiresAt <= now) {
    throw invalidToken();
  }

  await prisma.$transaction(async (tx) => {
    // Claim the token first: the same link cannot be used twice, even in parallel.
    const claimed = await tx.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalidToken();

    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
    // Only a pending account becomes active; a suspended account stays suspended.
    await tx.user.updateMany({
      where: { id: record.userId, status: 'PENDING_VERIFICATION' },
      data: { status: 'ACTIVE' },
    });
  });

  await recordAudit({
    actorId: record.userId,
    action: 'auth.email_verified',
    entityType: 'user',
    entityId: record.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.status !== 'PENDING_VERIFICATION') return;

  const token = await issueEmailToken(user.id, 'VERIFY_EMAIL', authConfig.verifyTokenTtlMs);
  if (token) {
    sendMailInBackground({
      to: user.email,
      ...verifyEmailEmail({ firstName: user.firstName, url: buildAppLink('/verify-email', token) }),
    });
  }
}

// -------------------------------------------------------------- password reset

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') return;

  const token = await issueEmailToken(user.id, 'PASSWORD_RESET', authConfig.resetTokenTtlMs);
  if (token) {
    sendMailInBackground({
      to: user.email,
      ...resetPasswordEmail({ firstName: user.firstName, url: buildAppLink('/reset-password', token) }),
    });
  }
}

export async function resetPassword(rawToken: string, newPassword: string, ctx: RequestContext): Promise<void> {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  const now = new Date();
  if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt <= now) {
    throw invalidToken();
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalidToken();

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    // Everyone signed in with the old password is signed out.
    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });

  await recordAudit({
    actorId: record.userId,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: record.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}