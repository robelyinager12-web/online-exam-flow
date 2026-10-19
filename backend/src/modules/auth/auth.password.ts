import { AppError } from '../../lib/appError';
import { hashPassword, verifyPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import type { RequestContext } from './auth.sessions';

interface ChangePasswordInput {
  userId: string;
  sessionId: string; // the current login session: it stays signed in
  currentPassword: string;
  newPassword: string;
}

// Change the password while signed in. Every OTHER device is signed out.
export async function changePassword(input: ChangePasswordInput, ctx: RequestContext): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Invalid session');
  }

  const currentMatches = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!currentMatches) {
    // 400, not 401: a wrong current password must not look like an expired login to the frontend.
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Your current password is incorrect');
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError(400, 'PASSWORD_UNCHANGED', 'Choose a password that is different from the current one');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null, familyId: { not: input.sessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    institutionId: user.institutionId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}