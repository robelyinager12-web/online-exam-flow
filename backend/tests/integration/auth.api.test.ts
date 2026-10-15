import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { sendMailInBackground } from '../../src/lib/mailer';
import { hashPassword } from '../../src/lib/password';
import { prisma } from '../../src/lib/prisma';
import { hashToken } from '../../src/lib/tokens';
import { resetMockDb } from '../helpers/db';

const app = createApp();

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'Correct-Pass-123';

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  resetMockDb();
});

const fakeUser = (overrides: Record<string, unknown> = {}) => ({
  id: USER_ID,
  institutionId: INSTITUTION_ID,
  email: 'student@demo.example',
  passwordHash,
  firstName: 'Stu',
  lastName: 'Dent',
  role: 'STUDENT',
  status: 'ACTIVE',
  studentNumber: null,
  phone: null,
  emailVerifiedAt: new Date(),
  lastLoginAt: null,
  failedLoginCount: 0,
  lockedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  institution: { id: INSTITUTION_ID, name: 'Demo', slug: 'demo', isActive: true },
  ...overrides,
});

const userFindUnique = () => vi.mocked(prisma.user.findUnique);
const userUpdate = () => vi.mocked(prisma.user.update);

function cookieValue(res: request.Response, name: string): string | undefined {
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const match = cookies.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0].slice(name.length + 1);
}

async function signIn(): Promise<string> {
  userFindUnique().mockResolvedValue(fakeUser() as never);
  userUpdate().mockResolvedValue({} as never);
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'student@demo.example', password: PASSWORD });
  return `ef_access=${cookieValue(res, 'ef_access')}`;
}

describe('POST /auth/register', () => {
  const payload = {
    email: 'New.Student@Demo.example',
    password: 'Strong-Pass-123',
    firstName: 'New',
    lastName: 'Student',
    institutionSlug: 'demo',
  };

  it('creates a pending student and sends a verification email', async () => {
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INSTITUTION_ID, isActive: true } as never);
    userFindUnique().mockResolvedValue(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: USER_ID, email: 'new.student@demo.example', firstName: 'New' } as never);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    const data = vi.mocked(prisma.user.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(data.email).toBe('new.student@demo.example');
    expect(data.role).toBe('STUDENT');
    expect(data.status).toBe('PENDING_VERIFICATION');
    expect(String(data.passwordHash).startsWith('$argon2id$')).toBe(true);
    expect(data).not.toHaveProperty('password');
    expect(sendMailInBackground).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendMailInBackground).mock.calls[0][0];
    expect(mail.to).toBe('new.student@demo.example');
    expect(mail.text).toContain('http://localhost:5173/verify-email?token=');
  });

  it('answers identically for an email that already exists and creates nothing', async () => {
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INSTITUTION_ID, isActive: true } as never);
    userFindUnique().mockResolvedValue({ id: USER_ID } as never);

    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(201);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('rejects a weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...payload, password: 'short1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown fields such as a self-assigned role', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ ...payload, role: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown institution', async () => {
    vi.mocked(prisma.institution.findUnique).mockResolvedValue(null as never);
    const res = await request(app).post('/api/v1/auth/register').send(payload);
    expect(res.status).toBe(404);
  });
});

describe('POST /auth/login', () => {
  const credentials = { email: 'Student@Demo.example', password: PASSWORD };

  it('signs in and sets httpOnly cookies without leaking the hash', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    userUpdate().mockResolvedValue({} as never);

    const res = await request(app).post('/api/v1/auth/login').send(credentials);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('student@demo.example');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(userFindUnique()).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'student@demo.example' } }),
    );

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('ef_access='))!;
    const refresh = cookies.find((c) => c.startsWith('ef_refresh='))!;
    expect(access).toContain('HttpOnly');
    expect(access).toContain('Path=/;');
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Path=/api/v1/auth');
    expect(prisma.refreshToken.create).toHaveBeenCalledOnce();
  });

  it('stores only the hash of the refresh token', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    userUpdate().mockResolvedValue({} as never);

    const res = await request(app).post('/api/v1/auth/login').send(credentials);
    const rawRefresh = cookieValue(res, 'ef_refresh')!;
    const stored = vi.mocked(prisma.refreshToken.create).mock.calls[0][0].data as { tokenHash: string };

    expect(stored.tokenHash).toBe(hashToken(rawRefresh));
    expect(stored.tokenHash).not.toBe(rawRefresh);
  });

  it('rejects a wrong password and counts the failure', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    userUpdate().mockResolvedValue({ failedLoginCount: 1 } as never);

    const res = await request(app).post('/api/v1/auth/login').send({ ...credentials, password: 'Wrong-Pass-999' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(userUpdate()).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('locks the account after the fifth failure', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    userUpdate().mockResolvedValue({ failedLoginCount: 5 } as never);

    const res = await request(app).post('/api/v1/auth/login').send({ ...credentials, password: 'Wrong-Pass-999' });

    expect(res.status).toBe(401);
    expect(userUpdate()).toHaveBeenCalledTimes(2);
    const lockCall = userUpdate().mock.calls[1][0] as { data: { lockedUntil: Date } };
    expect(lockCall.data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a locked account even with the right password', async () => {
    userFindUnique().mockResolvedValue(fakeUser({ lockedUntil: new Date(Date.now() + 5 * 60 * 1000) }) as never);

    const res = await request(app).post('/api/v1/auth/login').send(credentials);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    userFindUnique().mockResolvedValue(null as never);

    const res = await request(app).post('/api/v1/auth/login').send(credentials);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('blocks accounts whose email is not verified', async () => {
    userFindUnique().mockResolvedValue(fakeUser({ status: 'PENDING_VERIFICATION' }) as never);
    const res = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks suspended accounts and disabled institutions', async () => {
    userFindUnique().mockResolvedValue(fakeUser({ status: 'SUSPENDED' }) as never);
    const suspended = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_DISABLED');

    userFindUnique().mockResolvedValue(fakeUser({ institution: { isActive: false } }) as never);
    const disabledInstitution = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(disabledInstitution.status).toBe(403);
  });

  it('does not accept extra fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ ...credentials, role: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', 'ef_access=not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns the profile for a signed-in user', async () => {
    const cookie = await signIn();
    userFindUnique().mockResolvedValue(fakeUser() as never);

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'student@demo.example', role: 'STUDENT' });
    expect(res.body.data.user.institution).toEqual({ id: INSTITUTION_ID, name: 'Demo', slug: 'demo' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('also accepts a Bearer token for API clients', async () => {
    const cookie = await signIn();
    const token = cookie.replace('ef_access=', '');
    userFindUnique().mockResolvedValue(fakeUser() as never);

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /auth/refresh', () => {
  const RAW = 'raw-refresh-token-value-0123456789';
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt-1',
    userId: USER_ID,
    familyId: FAMILY_ID,
    tokenHash: hashToken(RAW),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    user: fakeUser(),
    ...overrides,
  });

  it('needs a refresh cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('rotates the token: old one claimed, new one issued in the same family', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(record() as never);
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.refreshToken.findUnique).mock.calls[0][0]).toMatchObject({
      where: { tokenHash: hashToken(RAW) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt-1', revokedAt: null } }),
    );
    const created = vi.mocked(prisma.refreshToken.create).mock.calls[0][0].data as { familyId: string };
    expect(created.familyId).toBe(FAMILY_ID);
    expect(cookieValue(res, 'ef_refresh')).toBeTruthy();
    expect(cookieValue(res, 'ef_refresh')).not.toBe(RAW);
    expect(cookieValue(res, 'ef_access')).toBeTruthy();
  });

  it('revokes the whole session family when an old token is replayed', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 5 * 60 * 1000) }) as never,
    );
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 3 } as never);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(401);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: FAMILY_ID, revokedAt: null } }),
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('treats a replay within seconds as a race, not theft', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
      record({ revokedAt: new Date(Date.now() - 2000) }) as never,
    );

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_CONFLICT');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('loses gracefully when another request claims the token first', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(record() as never);
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_CONFLICT');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects expired tokens and clears the cookies', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
      record({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(401);
    const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
    expect(cookies.some((c) => c.startsWith('ef_refresh=;'))).toBe(true);
  });

  it('refuses to refresh a suspended account', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
      record({ user: fakeUser({ status: 'SUSPENDED' }) }) as never,
    );

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `ef_refresh=${RAW}`);

    expect(res.status).toBe(403);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session family and clears both cookies', async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({ id: 'rt-1', userId: USER_ID, familyId: FAMILY_ID } as never);
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', 'ef_refresh=some-refresh-token-value');

    expect(res.status).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: FAMILY_ID, revokedAt: null } }),
    );
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('ef_access=;'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ef_refresh=;'))).toBe(true);
  });

  it('succeeds even when nobody is signed in', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('POST /auth/verify-email', () => {
  const TOKEN = 'a'.repeat(43);
  const emailToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'et-1',
    userId: USER_ID,
    type: 'VERIFY_EMAIL',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });

  it('activates a pending account with a valid token', async () => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(emailToken() as never);
    vi.mocked(prisma.emailToken.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.emailToken.findUnique).mock.calls[0][0]).toMatchObject({
      where: { tokenHash: hashToken(TOKEN) },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, status: 'PENDING_VERIFICATION' },
      data: { status: 'ACTIVE' },
    });
  });

  it.each([
    ['unknown', null],
    ['already used', emailToken({ usedAt: new Date() })],
    ['expired', emailToken({ expiresAt: new Date(Date.now() - 1000) })],
    ['a password reset token', emailToken({ type: 'PASSWORD_RESET' })],
  ])('rejects %s tokens', async (_label, record) => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(record as never);

    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a token that is claimed by a parallel request', async () => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(emailToken() as never);
    vi.mocked(prisma.emailToken.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: TOKEN });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('POST /auth/forgot-password', () => {
  const send = () => request(app).post('/api/v1/auth/forgot-password').send({ email: 'student@demo.example' });

  it('emails a reset link to an active account', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);

    const res = await send();

    expect(res.status).toBe(200);
    expect(sendMailInBackground).toHaveBeenCalledOnce();
    expect(vi.mocked(sendMailInBackground).mock.calls[0][0].text).toContain('/reset-password?token=');
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    userFindUnique().mockResolvedValue(null as never);

    const res = await send();

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('If an account');
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('does not email again within the throttle window', async () => {
    userFindUnique().mockResolvedValue(fakeUser() as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue({ id: 'recent' } as never);

    const res = await send();

    expect(res.status).toBe(200);
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('does not send resets to unverified or suspended accounts', async () => {
    userFindUnique().mockResolvedValue(fakeUser({ status: 'SUSPENDED' }) as never);
    const res = await send();
    expect(res.status).toBe(200);
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });
});

describe('POST /auth/reset-password', () => {
  const TOKEN = 'b'.repeat(43);
  const resetToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'et-2',
    userId: USER_ID,
    type: 'PASSWORD_RESET',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });

  it('sets the new password, unlocks the account and signs out every device', async () => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(resetToken() as never);
    vi.mocked(prisma.emailToken.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: TOKEN, password: 'Brand-New-Pass-456' });

    expect(res.status).toBe(200);
    const update = userUpdate().mock.calls[0][0] as { data: Record<string, unknown> };
    expect(String(update.data.passwordHash).startsWith('$argon2id$')).toBe(true);
    expect(update.data.failedLoginCount).toBe(0);
    expect(update.data.lockedUntil).toBeNull();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, revokedAt: null } }),
    );
  });

  it('rejects a weak new password before touching the token', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: TOKEN, password: 'weak' });
    expect(res.status).toBe(400);
    expect(prisma.emailToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an email-verification token used as a reset token', async () => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(resetToken({ type: 'VERIFY_EMAIL' }) as never);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: TOKEN, password: 'Brand-New-Pass-456' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an already used token', async () => {
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValue(resetToken({ usedAt: new Date() }) as never);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: TOKEN, password: 'Brand-New-Pass-456' });

    expect(res.status).toBe(400);
  });
});

describe('CSRF guard', () => {
  it('blocks state-changing requests from other origins', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('blocks form-style content types', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('email=a%40b.c&password=x');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('allows the real frontend origin', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
  });
});