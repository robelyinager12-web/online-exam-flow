import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/tokens';
import { resetMockDb } from '../helpers/db';

const app = createApp();

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CURRENT = 'Current-Pass-123';

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(CURRENT);
});

beforeEach(() => {
  resetMockDb();
});

const cookie = () =>
  `ef_access=${signAccessToken({ userId: USER_ID, role: 'STUDENT', institutionId: INSTITUTION_ID, sessionId: SESSION_ID })}`;

const dbUser = (overrides: Record<string, unknown> = {}) => ({
  id: USER_ID,
  institutionId: INSTITUTION_ID,
  email: 'student@demo.example',
  passwordHash,
  firstName: 'Stu',
  lastName: 'Dent',
  role: 'STUDENT',
  status: 'ACTIVE',
  failedLoginCount: 0,
  lockedUntil: null,
  deletedAt: null,
  institution: { isActive: true },
  ...overrides,
});

describe('POST /auth/change-password', () => {
  const change = (body: object) =>
    request(app).post('/api/v1/auth/change-password').set('Cookie', cookie()).send(body);

  it('needs a signed-in user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: CURRENT, newPassword: 'Brand-New-Pass-456' });
    expect(res.status).toBe(401);
  });

  it('changes the password and signs out every OTHER device', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser() as never);

    const res = await change({ currentPassword: CURRENT, newPassword: 'Brand-New-Pass-456' });

    expect(res.status).toBe(200);
    const update = vi.mocked(prisma.user.update).mock.calls[0][0].data as { passwordHash: string };
    expect(update.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(update.passwordHash).not.toBe(passwordHash);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, revokedAt: null, familyId: { not: SESSION_ID } } }),
    );
  });

  it('rejects a wrong current password without changing anything', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser() as never);

    const res = await change({ currentPassword: 'Wrong-Pass-999', newPassword: 'Brand-New-Pass-456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser() as never);

    const res = await change({ currentPassword: CURRENT, newPassword: CURRENT });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_UNCHANGED');
  });

  it('rejects a weak new password', async () => {
    const res = await change({ currentPassword: CURRENT, newPassword: 'weak' });
    expect(res.status).toBe(400);
  });

  it('stops a user who was deactivated after their token was issued', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser({ status: 'INACTIVE' }) as never);

    const res = await change({ currentPassword: CURRENT, newPassword: 'Brand-New-Pass-456' });

    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('invited users', () => {
  it('cannot sign in before they choose a password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      dbUser({ status: 'PENDING_VERIFICATION', passwordHash: '!never-a-real-hash' }) as never,
    );
    vi.mocked(prisma.user.update).mockResolvedValue({ failedLoginCount: 1 } as never);

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'student@demo.example', password: 'anything-at-all-1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('become active when they set their first password from the emailed link', async () => {
    const TOKEN = 'c'.repeat(43);
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue({
      id: 'et-9',
      userId: USER_ID,
      type: 'PASSWORD_RESET',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    vi.mocked(prisma.emailToken.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: TOKEN, password: 'First-Password-789' });

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.emailToken.findUnique).mock.calls[0][0]).toMatchObject({ where: { tokenHash: hashToken(TOKEN) } });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, status: 'PENDING_VERIFICATION' },
      data: { status: 'ACTIVE' },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, emailVerifiedAt: null },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });
});