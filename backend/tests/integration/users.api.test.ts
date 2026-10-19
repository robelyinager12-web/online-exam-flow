import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { RoleName } from '../../src/config/roles';
import { signAccessToken } from '../../src/lib/jwt';
import { sendMailInBackground } from '../../src/lib/mailer';
import { prisma } from '../../src/lib/prisma';
import { resetMockDb } from '../helpers/db';

const app = createApp();

const INST_A = '22222222-2222-4222-8222-222222222222';
const INST_B = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '55555555-5555-4555-8555-555555555555';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  resetMockDb();
});

const cookieFor = (role: RoleName, institutionId: string | null, userId = ADMIN_ID) =>
  `ef_access=${signAccessToken({ userId, role, institutionId, sessionId: SESSION_ID })}`;

const adminCookie = cookieFor('INSTITUTION_ADMIN', INST_A);
const superCookie = cookieFor('SUPER_ADMIN', null);

const actorRow = (overrides: Record<string, unknown> = {}) => ({
  id: ADMIN_ID,
  role: 'INSTITUTION_ADMIN',
  status: 'ACTIVE',
  institutionId: INST_A,
  deletedAt: null,
  institution: { isActive: true },
  ...overrides,
});

const targetRow = (overrides: Record<string, unknown> = {}) => ({
  id: TARGET_ID,
  email: 'target@demo.example',
  firstName: 'Tar',
  lastName: 'Get',
  role: 'STUDENT',
  status: 'ACTIVE',
  institutionId: INST_A,
  studentNumber: null,
  phone: null,
  emailVerifiedAt: new Date(),
  lastLoginAt: null,
  createdAt: new Date(),
  ...overrides,
});

const findUnique = () => vi.mocked(prisma.user.findUnique);
const findFirst = () => vi.mocked(prisma.user.findFirst);
const findMany = () => vi.mocked(prisma.user.findMany);
const userCreate = () => vi.mocked(prisma.user.create);
const userUpdate = () => vi.mocked(prisma.user.update);
const sessionsRevoked = () => vi.mocked(prisma.refreshToken.updateMany);

// The first user lookup of every admin request is the "who is acting" check.
const actingAs = (overrides: Record<string, unknown> = {}) =>
  findUnique().mockResolvedValueOnce(actorRow(overrides) as never);

describe('access control', () => {
  it('needs a signed-in user', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it.each(['STUDENT', 'INSTRUCTOR', 'PROCTOR'] as const)('forbids the %s role', async (role) => {
    const res = await request(app).get('/api/v1/users').set('Cookie', cookieFor(role, INST_A));
    expect(res.status).toBe(403);
    expect(findUnique()).not.toHaveBeenCalled();
  });

  it('stops an admin who was deactivated after their token was issued', async () => {
    actingAs({ status: 'INACTIVE' });
    const res = await request(app).get('/api/v1/users').set('Cookie', adminCookie);
    expect(res.status).toBe(401);
  });

  it('stops an admin who was demoted after their token was issued', async () => {
    actingAs({ role: 'STUDENT' });
    const res = await request(app).get('/api/v1/users').set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /users', () => {
  const callList = async (query = '', cookie = adminCookie, actor: Record<string, unknown> = {}) => {
    actingAs(actor);
    vi.mocked(prisma.user.count).mockResolvedValue(45 as never);
    findMany().mockResolvedValue([targetRow()] as never);
    return request(app).get(`/api/v1/users${query}`).set('Cookie', cookie);
  };

  it('is limited to the admin’s institution and never selects the password hash', async () => {
    const res = await callList();

    expect(res.status).toBe(200);
    const args = findMany().mock.calls[0][0]!;
    expect(args.where).toMatchObject({ institutionId: INST_A, deletedAt: null });
    expect(args.select).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
  });

  it('ignores an institution filter from an institution admin', async () => {
    await callList(`?institutionId=${INST_B}`);
    expect(findMany().mock.calls[0][0]!.where).toMatchObject({ institutionId: INST_A });
  });

  it('lets a super admin see all institutions, or filter to one', async () => {
    await callList('', superCookie, { role: 'SUPER_ADMIN', institutionId: null });
    expect(findMany().mock.calls[0][0]!.where).not.toHaveProperty('institutionId');

    resetMockDb();
    await callList(`?institutionId=${INST_B}`, superCookie, { role: 'SUPER_ADMIN', institutionId: null });
    expect(findMany().mock.calls[0][0]!.where).toMatchObject({ institutionId: INST_B });
  });

  it('applies search, filters and paging', async () => {
    await callList('?q=abel&role=STUDENT&status=ACTIVE&page=3&pageSize=10&sortBy=lastName&order=asc');

    const args = findMany().mock.calls[0][0]!;
    expect(args.where).toMatchObject({ role: 'STUDENT', status: 'ACTIVE' });
    expect(args.where!.OR).toHaveLength(4);
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual([{ lastName: 'asc' }, { id: 'asc' }]);
  });

  it('rejects oversized pages and unknown parameters', async () => {
    expect((await callList('?pageSize=500')).status).toBe(400);
    expect((await callList('?passwordHash=1')).status).toBe(400);
  });
});

describe('POST /users', () => {
  const payload = { email: 'Teacher@Demo.example', firstName: 'Tea', lastName: 'Cher', role: 'INSTRUCTOR' };

  const mockCreateSuccess = (institutionId = INST_A) => {
    findUnique().mockResolvedValueOnce(null as never); // email is free
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: institutionId, name: 'Demo Institute', isActive: true } as never);
    userCreate().mockResolvedValue(targetRow({ role: 'INSTRUCTOR', status: 'PENDING_VERIFICATION', institutionId }) as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);
  };

  it('creates a pending user in the admin’s institution and sends an invitation', async () => {
    actingAs();
    mockCreateSuccess();

    const res = await request(app).post('/api/v1/users').set('Cookie', adminCookie).send(payload);

    expect(res.status).toBe(201);
    const data = userCreate().mock.calls[0][0].data as Record<string, unknown>;
    expect(data.institutionId).toBe(INST_A);
    expect(data.email).toBe('teacher@demo.example');
    expect(data.status).toBe('PENDING_VERIFICATION');
    expect(String(data.passwordHash).startsWith('!')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    expect(sendMailInBackground).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendMailInBackground).mock.calls[0][0];
    expect(mail.text).toContain('/reset-password?token=');
    expect(mail.subject).toContain('Demo Institute');
  });

  it('refuses to create users in another institution', async () => {
    actingAs();
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ ...payload, institutionId: INST_B });

    expect(res.status).toBe(403);
    expect(userCreate()).not.toHaveBeenCalled();
  });

  it('never lets an institution admin create a super admin', async () => {
    actingAs();
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ ...payload, role: 'SUPER_ADMIN' });

    expect(res.status).toBe(403);
    expect(userCreate()).not.toHaveBeenCalled();
  });

  it('requires an institution when a super admin creates a regular user', async () => {
    actingAs({ role: 'SUPER_ADMIN', institutionId: null });
    const res = await request(app).post('/api/v1/users').set('Cookie', superCookie).send(payload);
    expect(res.status).toBe(400);
  });

  it('lets a super admin create a user in any institution', async () => {
    actingAs({ role: 'SUPER_ADMIN', institutionId: null });
    mockCreateSuccess(INST_B);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', superCookie)
      .send({ ...payload, institutionId: INST_B });

    expect(res.status).toBe(201);
    expect((userCreate().mock.calls[0][0].data as { institutionId: string }).institutionId).toBe(INST_B);
  });

  it('lets a super admin create another super admin without an institution', async () => {
    actingAs({ role: 'SUPER_ADMIN', institutionId: null });
    findUnique().mockResolvedValueOnce(null as never);
    userCreate().mockResolvedValue(targetRow({ role: 'SUPER_ADMIN', institutionId: null }) as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', superCookie)
      .send({ ...payload, role: 'SUPER_ADMIN' });

    expect(res.status).toBe(201);
    expect((userCreate().mock.calls[0][0].data as { institutionId: unknown }).institutionId).toBeNull();
  });

  it('rejects a duplicate email', async () => {
    actingAs();
    findUnique().mockResolvedValueOnce({ id: 'someone' } as never);
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INST_A, name: 'Demo', isActive: true } as never);

    const res = await request(app).post('/api/v1/users').set('Cookie', adminCookie).send(payload);

    expect(res.status).toBe(409);
    expect(userCreate()).not.toHaveBeenCalled();
  });

  it('rejects a student number that is already used', async () => {
    actingAs();
    findUnique().mockResolvedValueOnce(null as never);
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INST_A, name: 'Demo', isActive: true } as never);
    findFirst().mockResolvedValue({ id: 'someone' } as never);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ ...payload, role: 'STUDENT', studentNumber: 'S-0001' });

    expect(res.status).toBe(409);
    expect(userCreate()).not.toHaveBeenCalled();
  });

  it('does not accept a password or other unknown fields', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .send({ ...payload, password: 'Sneaky-Pass-123' });
    expect(res.status).toBe(400);
  });
});

describe('GET /users/:id', () => {
  it('returns 404 for a user of another institution, by querying with the scope', async () => {
    actingAs();
    findFirst().mockResolvedValue(null as never);

    const res = await request(app).get(`/api/v1/users/${TARGET_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(findFirst().mock.calls[0][0]!.where).toEqual({ id: TARGET_ID, deletedAt: null, institutionId: INST_A });
  });

  it('returns the user inside the scope', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);

    const res = await request(app).get(`/api/v1/users/${TARGET_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('target@demo.example');
  });

  it('rejects an id that is not a UUID', async () => {
    const res = await request(app).get('/api/v1/users/not-a-uuid').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /users/:id', () => {
  const patch = (body: unknown) => request(app).patch(`/api/v1/users/${TARGET_ID}`).set('Cookie', adminCookie).send(body as object);

  it('updates profile fields without touching sessions', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);
    userUpdate().mockResolvedValue(targetRow({ firstName: 'Taro' }) as never);

    const res = await patch({ firstName: 'Taro' });

    expect(res.status).toBe(200);
    expect(sessionsRevoked()).not.toHaveBeenCalled();
  });

  it('changes a role and signs the user out everywhere', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);
    userUpdate().mockResolvedValue(targetRow({ role: 'INSTRUCTOR' }) as never);

    const res = await patch({ role: 'INSTRUCTOR' });

    expect(res.status).toBe(200);
    expect(sessionsRevoked()).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: TARGET_ID, revokedAt: null } }));
    const actions = vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0].data as { action: string }).action);
    expect(actions).toContain('user.role_change');
  });

  it('blocks changing your own role', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ id: ADMIN_ID, role: 'INSTITUTION_ADMIN' }) as never);

    const res = await request(app).patch(`/api/v1/users/${ADMIN_ID}`).set('Cookie', adminCookie).send({ role: 'STUDENT' });

    expect(res.status).toBe(403);
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('blocks promotion to super admin', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);

    const res = await patch({ role: 'SUPER_ADMIN' });

    expect(res.status).toBe(403);
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('keeps the last administrator of an institution', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ role: 'INSTITUTION_ADMIN' }) as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);

    const res = await patch({ role: 'INSTRUCTOR' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('rejects a student number used by someone else', async () => {
    actingAs();
    findFirst().mockResolvedValueOnce(targetRow() as never); // the target
    findFirst().mockResolvedValueOnce({ id: 'someone-else' } as never); // the clash

    const res = await patch({ studentNumber: 'S-0009' });

    expect(res.status).toBe(409);
  });

  it('rejects an empty update and unknown fields', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: 'ACTIVE' })).status).toBe(400);
    expect((await patch({ email: 'new@demo.example' })).status).toBe(400);
  });
});

describe('deactivate, reactivate and delete', () => {
  const post = (path: string) => request(app).post(`/api/v1/users/${TARGET_ID}/${path}`).set('Cookie', adminCookie);

  it('deactivates a user and ends all of their sessions', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);
    userUpdate().mockResolvedValue(targetRow({ status: 'INACTIVE' }) as never);

    const res = await post('deactivate');

    expect(res.status).toBe(200);
    expect(userUpdate()).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'INACTIVE' } }));
    expect(sessionsRevoked()).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: TARGET_ID, revokedAt: null } }));
  });

  it('does nothing when the user is already inactive', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ status: 'INACTIVE' }) as never);

    const res = await post('deactivate');

    expect(res.status).toBe(200);
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('will not deactivate yourself', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ id: ADMIN_ID }) as never);

    const res = await request(app).post(`/api/v1/users/${ADMIN_ID}/deactivate`).set('Cookie', adminCookie);

    expect(res.status).toBe(403);
  });

  it('will not deactivate the last administrator', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ role: 'INSTITUTION_ADMIN' }) as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);

    const res = await post('deactivate');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('cannot reach a user of another institution', async () => {
    actingAs();
    findFirst().mockResolvedValue(null as never);

    const res = await post('deactivate');

    expect(res.status).toBe(404);
    expect(userUpdate()).not.toHaveBeenCalled();
  });

  it('reactivates a verified user as active and an unverified one as pending', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ status: 'INACTIVE' }) as never);
    userUpdate().mockResolvedValue(targetRow() as never);
    await post('reactivate');
    expect(userUpdate().mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null });

    resetMockDb();
    actingAs();
    findFirst().mockResolvedValue(targetRow({ status: 'INACTIVE', emailVerifiedAt: null }) as never);
    userUpdate().mockResolvedValue(targetRow() as never);
    await post('reactivate');
    expect(userUpdate().mock.calls[0][0].data).toMatchObject({ status: 'PENDING_VERIFICATION' });
  });

  it('refuses to reactivate a user who is not deactivated', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);

    const res = await post('reactivate');

    expect(res.status).toBe(409);
  });

  it('soft-deletes a user and ends their sessions', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);
    userUpdate().mockResolvedValue(targetRow() as never);

    const res = await request(app).delete(`/api/v1/users/${TARGET_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const data = userUpdate().mock.calls[0][0].data as { deletedAt: Date; status: string };
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('INACTIVE');
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(sessionsRevoked()).toHaveBeenCalled();
  });

  it('will not delete yourself', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ id: ADMIN_ID }) as never);

    const res = await request(app).delete(`/api/v1/users/${ADMIN_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(403);
    expect(userUpdate()).not.toHaveBeenCalled();
  });
});

describe('POST /users/:id/resend-invite', () => {
  const resend = () => request(app).post(`/api/v1/users/${TARGET_ID}/resend-invite`).set('Cookie', adminCookie);

  it('sends a new invitation to a pending user', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ status: 'PENDING_VERIFICATION' }) as never);
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ name: 'Demo' } as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);

    const res = await resend();

    expect(res.status).toBe(200);
    expect(sendMailInBackground).toHaveBeenCalledOnce();
  });

  it('refuses for users who already activated their account', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow() as never);

    const res = await resend();

    expect(res.status).toBe(409);
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('answers 429 when an invitation was just sent', async () => {
    actingAs();
    findFirst().mockResolvedValue(targetRow({ status: 'PENDING_VERIFICATION' }) as never);
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ name: 'Demo' } as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue({ id: 'recent' } as never);

    const res = await resend();

    expect(res.status).toBe(429);
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });
});

describe('POST /users/import', () => {
  const header = 'email,firstName,lastName,role,studentNumber\n';

  const mockImportDb = (existingEmails: string[] = []) => {
    actingAs();
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INST_A, name: 'Demo Institute', isActive: true } as never);
    findMany().mockImplementation((async (args: { where: Record<string, unknown> }) =>
      'email' in args.where ? existingEmails.map((email) => ({ email })) : []) as never);
    userCreate().mockImplementation((async ({ data }: { data: { email: string; firstName: string } }) => ({
      id: `id-${data.email}`,
      email: data.email,
      firstName: data.firstName,
    })) as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);
  };

  const upload = (csv: string | Buffer, query = '', options: { filename?: string; contentType?: string; cookie?: string } = {}) =>
    request(app)
      .post(`/api/v1/users/import${query}`)
      .set('Cookie', options.cookie ?? adminCookie)
      .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv), {
        filename: options.filename ?? 'users.csv',
        contentType: options.contentType ?? 'text/csv',
      });

  it('previews a file without creating anything (dry run)', async () => {
    mockImportDb();

    const res = await upload(`${header}a@demo.example,Aa,Bb,STUDENT,S-1\nb@demo.example,Cc,Dd,,\n`, '?dryRun=true');

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({ total: 2, readyToCreate: 2, created: 0, dryRun: true });
    expect(userCreate()).not.toHaveBeenCalled();
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('creates valid rows, invites them, and reports the rest', async () => {
    mockImportDb(['exists@demo.example']);
    const csv =
      header +
      'new1@demo.example,New,One,student,S-1\n' + // role is case-insensitive
      'exists@demo.example,Old,User,STUDENT,\n' + // already in the system
      'not-an-email,Bad,Row,STUDENT,\n' + // invalid email
      'new1@demo.example,Dup,Row,STUDENT,\n' + // duplicate in the file
      'root@demo.example,Super,Admin,SUPER_ADMIN,\n' + // not importable
      'new2@demo.example,New,Two,,S-1\n' + // student number repeated in the file
      'new3@demo.example,New,Three,INSTRUCTOR,\n';

    const res = await upload(csv);

    expect(res.status).toBe(200);
    const { summary, rows } = res.body.data;
    expect(summary).toMatchObject({ total: 7, created: 2, skipped: 1, failed: 4, dryRun: false });
    expect(rows.map((r: { status: string }) => r.status)).toEqual([
      'created', 'skipped', 'error', 'error', 'error', 'error', 'created',
    ]);
    expect(userCreate()).toHaveBeenCalledTimes(2);
    expect(sendMailInBackground).toHaveBeenCalledTimes(2);

    const created = userCreate().mock.calls.map((c) => c[0].data as Record<string, unknown>);
    expect(created.every((d) => d.institutionId === INST_A && d.status === 'PENDING_VERIFICATION')).toBe(true);
    expect(created.every((d) => String(d.passwordHash).startsWith('!'))).toBe(true);
    expect(created[0].role).toBe('STUDENT');
    expect(created[1].role).toBe('INSTRUCTOR');
  });

  it('reads Excel-style files: BOM, semicolons and friendly column names', async () => {
    mockImportDb();
    const csv = '\uFEFFE-mail;First name;Surname;Student ID\r\na@demo.example;Aa;Bb;S-7\r\n';

    const res = await upload(csv, '?dryRun=true');

    expect(res.status).toBe(200);
    expect(res.body.data.summary.readyToCreate).toBe(1);
  });

  it('rejects files with missing columns, no rows, or too many rows', async () => {
    // Each request starts with its own "who is acting" lookup, so the mocks are set up per upload.
    mockImportDb();
    const missing = await upload('email,firstName\na@demo.example,Aa\n');
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('lastName');

    mockImportDb();
    const empty = await upload(header);
    expect(empty.status).toBe(400);

    mockImportDb();
    const many = header + Array.from({ length: 501 }, (_, i) => `u${i}@demo.example,A,B,STUDENT,`).join('\n');
    const tooMany = await upload(many);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toContain('500');
  });

  it('only accepts .csv uploads', async () => {
    const res = await upload('x', '', { filename: 'users.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE');
  });

  it('rejects files over 1 MB', async () => {
    const res = await upload(Buffer.alloc(1024 * 1024 + 10, 'a'));
    expect(res.status).toBe(413);
  });

  it('needs a file', async () => {
    actingAs();
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: INST_A, name: 'Demo', isActive: true } as never);
    const res = await request(app).post('/api/v1/users/import').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('asks a super admin which institution to import into', async () => {
    actingAs({ role: 'SUPER_ADMIN', institutionId: null });
    const res = await upload(`${header}a@demo.example,Aa,Bb,,\n`, '', { cookie: superCookie });
    expect(res.status).toBe(400);
  });

  it('is closed to non-admins', async () => {
    const res = await upload(`${header}a@demo.example,Aa,Bb,,\n`, '', { cookie: cookieFor('INSTRUCTOR', INST_A) });
    expect(res.status).toBe(403);
  });
});