import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authConfig } from '../config/auth';
import { env } from '../config/env';
import { ROLES, type RoleName } from '../config/roles';
import { AppError } from './appError';

const payloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(ROLES),
  institutionId: z.string().uuid().nullable(),
  sid: z.string().uuid(),
});

export type AccessTokenPayload = z.infer<typeof payloadSchema>;

interface SignInput {
  userId: string;
  role: RoleName;
  institutionId: string | null;
  sessionId: string;
}

export function signAccessToken(input: SignInput): string {
  return jwt.sign(
    { role: input.role, institutionId: input.institutionId, sid: input.sessionId },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      subject: input.userId,
      expiresIn: authConfig.accessTtlSeconds,
      issuer: authConfig.jwtIssuer,
      audience: authConfig.jwtAudience,
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      // Pinning the algorithm blocks "alg: none" and algorithm-confusion attacks.
      algorithms: ['HS256'],
      issuer: authConfig.jwtIssuer,
      audience: authConfig.jwtAudience,
    });
    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
  }
}