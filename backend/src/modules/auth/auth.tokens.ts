import type { EmailTokenType } from '@prisma/client';
import { authConfig } from '../../config/auth';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { generateToken, hashToken } from '../../lib/tokens';

// Creates a one-time email token (email verification or password reset) and returns the raw
// token to put in the email link. Only the hash is stored. Returns null when the user already
// received an email of this type within the throttle window, so nobody can be email-bombed.
export async function issueEmailToken(
  userId: string,
  type: EmailTokenType,
  ttlMs: number,
): Promise<string | null> {
  const recent = await prisma.emailToken.findFirst({
    where: { userId, type, createdAt: { gt: new Date(Date.now() - authConfig.emailThrottleMs) } },
    select: { id: true },
  });
  if (recent) {
    return null;
  }

  const token = generateToken();
  await prisma.$transaction([
    // Older unused links stop working as soon as a new one is issued.
    prisma.emailToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.emailToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

export function buildAppLink(path: string, token: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
}