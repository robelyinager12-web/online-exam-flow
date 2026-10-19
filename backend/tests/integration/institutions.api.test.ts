import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { sendMailInBackground } from '../../src/lib/mailer';
import { prisma } from '../../src/lib/prisma';
import { actingAs, cookieFor, IDS } from '../helpers/actors';
import { resetMockDb } from '../helpers/db';

const app = createApp();
const { instA, instB } = IDS;

beforeEach(() => {
  resetMockDb();
});

const superCookie = cookieFor('SUPER_ADMIN', null);
const adminCookie = cookieFor('INSTITUTION_ADMIN');

const institutionRow = (overrides: Record<string, unknown> = {}) => ({
  id: instA,
  name: 'Demo Institute',
  slug: 'demo-institute',
  contactEmail: 'office@demo.example',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const findInstitution = () => vi.mocked(prisma.institution.findUnique);
const updateInstitution = () => vi.mocked(prisma.institution.update);

describe('GET /institutions', () => {
  const list = (cookie = superCookie, query = '') => request(app).get(`/api/v1/institutions${query}`).set('Cookie', cookie);

  it('is for super admins only', async () => {
    expect((await request(app).get('/api/v1/institutions')).status).toBe(401);
    for (const role of ['INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT'] as const) {
      const res = await list(cookieFor(role));
      expect(res.status).toBe(403);
    }
  });

  it('lists institutions with search, filter and paging', async () => {
    actingAs('SUPER_ADMIN');
    vi.mocked(prisma.institution.count).mockResolvedValue(30 as never);
    vi.mocked(prisma.institution.findMany).mockResolvedValue([institutionRow()] as never);

    const res = await list(superCookie, '?q=demo&isActive=true&page=2&pageSize=10&sortBy=createdAt&order=desc');

    expect(res.status).toBe(200);
    const args = vi.mocked(prisma.institution.findMany).mock.calls[0][0]!;
    expect(args.where).toMatchObject({ isActive: true });
    expect(args.where!.OR).toHaveLength(2);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 10, total: 30, totalPages: 3 });
  });

  it('rejects unknown query parameters', async () => {
    actingAs('SUPER_ADMIN');
    expect((await list(superCookie, '?hack=1')).status).toBe(400);
  });
});

describe('POST /institutions', () => {
  const payload = {
    name: 'Bright Future College',
    slug: 'bright-future',
    contactEmail: 'office@bright.example',
    admin: { email: 'Head@Bright.example', firstName: 'Hana', lastName: 'Girma' },
  };
  const create = (body: object, cookie = superCookie) =>
    request(app).post('/api/v1/institutions').set('Cookie', cookie).send(body);

  const mockSuccess = () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never); // admin email is free
    findInstitution().mockResolvedValue(null as never); // slug is free
    vi.mocked(prisma.institution.create).mockResolvedValue(
      institutionRow({ id: instB, name: payload.name, slug: payload.slug }) as never,
    );
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: IDS.other,
      email: 'head@bright.example',
      firstName: 'Hana',
      lastName: 'Girma',
      role: 'INSTITUTION_ADMIN',
      status: 'PENDING_VERIFICATION',
    } as never);
    vi.mocked(prisma.emailToken.findFirst).mockResolvedValue(null as never);
  };

  it('creates the institution together with its first admin and invites them', async () => {
    actingAs('SUPER_ADMIN');
    mockSuccess();

    const res = await create(payload);

    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.institution.create).mock.calls[0][0].data).toMatchObject({ slug: 'bright-future' });
    const admin = vi.mocked(prisma.user.create).mock.calls[0][0].data as Record<string, unknown>;
    expect(admin).toMatchObject({
      institutionId: instB,
      email: 'head@bright.example',
      role: 'INSTITUTION_ADMIN',
      status: 'PENDING_VERIFICATION',
    });
    expect(String(admin.passwordHash).startsWith('!')).toBe(true);
    expect(sendMailInBackground).toHaveBeenCalledOnce();
    expect(vi.mocked(sendMailInBackground).mock.calls[0][0].text).toContain('/reset-password?token=');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('can create an institution without an admin', async () => {
    actingAs('SUPER_ADMIN');
    findInstitution().mockResolvedValue(null as never);
    vi.mocked(prisma.institution.create).mockResolvedValue(institutionRow({ id: instB }) as never);

    const res = await create({ name: 'Solo Institute', slug: 'solo' });

    expect(res.status).toBe(201);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sendMailInBackground).not.toHaveBeenCalled();
  });

  it('rejects a slug that is already taken', async () => {
    actingAs('SUPER_ADMIN');
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    findInstitution().mockResolvedValue({ id: 'existing' } as never);

    const res = await create(payload);

    expect(res.status).toBe(409);
    expect(prisma.institution.create).not.toHaveBeenCalled();
  });

  it('rejects an admin email that is already registered, before creating anything', async () => {
    actingAs('SUPER_ADMIN');
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'someone' } as never);

    const res = await create(payload);

    expect(res.status).toBe(409);
    expect(prisma.institution.create).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid slug', { ...payload, slug: 'Bad Slug!' }],
    ['a name with markup', { ...payload, name: '<b>Evil</b>' }],
    ['unknown fields', { ...payload, isActive: false }],
  ])('rejects %s', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
  });

  it('is closed to institution admins', async () => {
    const res = await create(payload, adminCookie);
    expect(res.status).toBe(403);
    expect(prisma.institution.create).not.toHaveBeenCalled();
  });
});

describe('GET /institutions/:id and /current', () => {
  it('lets an institution admin read their own institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    findInstitution().mockResolvedValue(institutionRow() as never);

    const res = await request(app).get(`/api/v1/institutions/${instA}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.institution.slug).toBe('demo-institute');
  });

  it('answers 404 for another institution without even querying it', async () => {
    actingAs('INSTITUTION_ADMIN');

    const res = await request(app).get(`/api/v1/institutions/${instB}`).set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(findInstitution()).not.toHaveBeenCalled();
  });

  it('lets a super admin read any institution', async () => {
    actingAs('SUPER_ADMIN');
    findInstitution().mockResolvedValue(institutionRow({ id: instB }) as never);

    const res = await request(app).get(`/api/v1/institutions/${instB}`).set('Cookie', superCookie);

    expect(res.status).toBe(200);
  });

  it('shows every role their own institution at /current', async () => {
    actingAs('STUDENT');
    findInstitution().mockResolvedValue(institutionRow() as never);

    const res = await request(app).get('/api/v1/institutions/current').set('Cookie', cookieFor('STUDENT'));

    expect(res.status).toBe(200);
    expect(findInstitution()).toHaveBeenCalledWith(expect.objectContaining({ where: { id: instA } }));
  });

  it('has no "current" institution for a super admin', async () => {
    actingAs('SUPER_ADMIN');
    const res = await request(app).get('/api/v1/institutions/current').set('Cookie', superCookie);
    expect(res.status).toBe(404);
  });

  it('stops users of a deactivated institution', async () => {
    actingAs('INSTRUCTOR', { institution: { isActive: false } });
    const res = await request(app).get('/api/v1/institutions/current').set('Cookie', cookieFor('INSTRUCTOR'));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /institutions/:id', () => {
  const patch = (id: string, body: object, cookie: string) =>
    request(app).patch(`/api/v1/institutions/${id}`).set('Cookie', cookie).send(body);

  it('lets an institution admin change the name and contact email of their own institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    findInstitution().mockResolvedValue(institutionRow() as never);
    updateInstitution().mockResolvedValue(institutionRow({ name: 'Renamed' }) as never);

    const res = await patch(instA, { name: 'Renamed', contactEmail: 'new@demo.example' }, adminCookie);

    expect(res.status).toBe(200);
    expect(updateInstitution().mock.calls[0][0].data).toMatchObject({ name: 'Renamed', contactEmail: 'new@demo.example' });
  });

  it('stops an institution admin from changing the slug or the active state', async () => {
    for (const body of [{ slug: 'hijack' }, { isActive: false }]) {
      actingAs('INSTITUTION_ADMIN');
      findInstitution().mockResolvedValue(institutionRow() as never);
      const res = await patch(instA, body, adminCookie);
      expect(res.status).toBe(403);
    }
    expect(updateInstitution()).not.toHaveBeenCalled();
  });

  it('cannot reach another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    const res = await patch(instB, { name: 'Mine now' }, adminCookie);
    expect(res.status).toBe(404);
    expect(updateInstitution()).not.toHaveBeenCalled();
  });

  it('rejects a slug that is already used', async () => {
    actingAs('SUPER_ADMIN');
    findInstitution().mockResolvedValueOnce(institutionRow() as never); // the institution
    findInstitution().mockResolvedValueOnce({ id: 'other' } as never); // slug lookup

    const res = await patch(instA, { slug: 'taken' }, superCookie);

    expect(res.status).toBe(409);
    expect(updateInstitution()).not.toHaveBeenCalled();
  });

  it('deactivating an institution signs out all of its users', async () => {
    actingAs('SUPER_ADMIN');
    findInstitution().mockResolvedValue(institutionRow() as never);
    updateInstitution().mockResolvedValue(institutionRow({ isActive: false }) as never);

    const res = await patch(instA, { isActive: false }, superCookie);

    expect(res.status).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { institutionId: instA }, revokedAt: null } }),
    );
    const actions = vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0].data as { action: string }).action);
    expect(actions).toContain('institution.deactivate');
  });

  it('reactivating does not touch sessions', async () => {
    actingAs('SUPER_ADMIN');
    findInstitution().mockResolvedValue(institutionRow({ isActive: false }) as never);
    updateInstitution().mockResolvedValue(institutionRow() as never);

    const res = await patch(instA, { isActive: true }, superCookie);

    expect(res.status).toBe(200);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects empty updates and unknown fields', async () => {
    expect((await patch(instA, {}, adminCookie)).status).toBe(400);
    expect((await patch(instA, { id: instB }, adminCookie)).status).toBe(400);
  });
});

describe('institution settings', () => {
  const getSettings = (id: string, cookie: string) =>
    request(app).get(`/api/v1/institutions/${id}/settings`).set('Cookie', cookie);
  const putSettings = (id: string, body: object, cookie: string) =>
    request(app).put(`/api/v1/institutions/${id}/settings`).set('Cookie', cookie).send(body);

  it('returns the defaults mixed with stored values', async () => {
    actingAs('INSTITUTION_ADMIN');
    findInstitution().mockResolvedValue(institutionRow() as never);
    vi.mocked(prisma.setting.findMany).mockResolvedValue([
      { key: 'timezone', value: 'Africa/Addis_Ababa' },
      { key: 'defaultPassMarkPercent', value: 'not-a-number' }, // broken stored value is ignored
      { key: 'somethingOld', value: 1 }, // unknown key is ignored
    ] as never);

    const res = await getSettings(instA, adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.settings).toEqual({
      timezone: 'Africa/Addis_Ababa',
      defaultPassMarkPercent: 50,
      defaultExamDurationMinutes: 60,
      defaultMaxAttempts: 1,
      showCorrectAnswersByDefault: false,
    });
  });

  it('lets instructors read the settings of their own institution only', async () => {
    actingAs('INSTRUCTOR');
    findInstitution().mockResolvedValue(institutionRow() as never);
    vi.mocked(prisma.setting.findMany).mockResolvedValue([] as never);
    expect((await getSettings(instA, cookieFor('INSTRUCTOR'))).status).toBe(200);

    actingAs('INSTRUCTOR');
    expect((await getSettings(instB, cookieFor('INSTRUCTOR'))).status).toBe(404);
  });

  it('is closed to students', async () => {
    const res = await getSettings(instA, cookieFor('STUDENT'));
    expect(res.status).toBe(403);
  });

  it('saves only the settings that were sent', async () => {
    actingAs('INSTITUTION_ADMIN');
    findInstitution().mockResolvedValue(institutionRow() as never);
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.setting.findMany).mockResolvedValue([{ key: 'defaultMaxAttempts', value: 3 }] as never);

    const res = await putSettings(instA, { defaultMaxAttempts: 3, showCorrectAnswersByDefault: true }, adminCookie);

    expect(res.status).toBe(200);
    expect(prisma.setting.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.setting.upsert).toHaveBeenCalledWith({
      where: { institutionId_key: { institutionId: instA, key: 'defaultMaxAttempts' } },
      update: { value: 3 },
      create: { institutionId: instA, key: 'defaultMaxAttempts', value: 3 },
    });
    expect(res.body.data.settings.defaultMaxAttempts).toBe(3);
  });

  it.each([
    ['a pass mark above 100', { defaultPassMarkPercent: 150 }],
    ['a duration that is too short', { defaultExamDurationMinutes: 1 }],
    ['a fractional attempt limit', { defaultMaxAttempts: 2.5 }],
    ['an invalid timezone', { timezone: 'Mars/Olympus' }],
    ['a string where a boolean is expected', { showCorrectAnswersByDefault: 'yes' }],
    ['an unknown setting', { anything: 1 }],
    ['an empty update', {}],
  ])('rejects %s', async (_label, body) => {
    const res = await putSettings(instA, body, adminCookie);
    expect(res.status).toBe(400);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('does not let an instructor change settings', async () => {
    const res = await putSettings(instA, { defaultMaxAttempts: 2 }, cookieFor('INSTRUCTOR'));
    expect(res.status).toBe(403);
  });

  it('does not let an admin change another institution’s settings', async () => {
    actingAs('INSTITUTION_ADMIN');
    const res = await putSettings(instB, { defaultMaxAttempts: 2 }, adminCookie);
    expect(res.status).toBe(404);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });
});