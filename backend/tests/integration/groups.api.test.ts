import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actingAs, cookieFor, IDS } from '../helpers/actors';
import { resetMockDb } from '../helpers/db';

const app = createApp();
const { instA, instB, actor, other, other2 } = IDS;
const GROUP_ID = '88888888-8888-4888-8888-888888888888';
const COURSE_ID = '77777777-7777-4777-8777-777777777777';

beforeEach(() => {
  resetMockDb();
});

const adminCookie = cookieFor('INSTITUTION_ADMIN');
const superCookie = cookieFor('SUPER_ADMIN', null);
const instructorCookie = cookieFor('INSTRUCTOR');

const groupRow = (overrides: Record<string, unknown> = {}) => ({
  id: GROUP_ID,
  institutionId: instA,
  courseId: COURSE_ID,
  name: 'CS101 - Class A',
  academicYear: '2026',
  createdAt: new Date(),
  updatedAt: new Date(),
  course: { id: COURSE_ID, code: 'CS101', name: 'Intro' },
  _count: { members: 25 },
  ...overrides,
});

const groupFindFirst = () => vi.mocked(prisma.group.findFirst);
const groupFindUnique = () => vi.mocked(prisma.group.findUnique);
const groupUpdate = () => vi.mocked(prisma.group.update);
const courseFindFirst = () => vi.mocked(prisma.course.findFirst);

describe('GET /groups', () => {
  const list = async (cookie: string, role: Parameters<typeof actingAs>[0], query = '') => {
    actingAs(role);
    vi.mocked(prisma.group.count).mockResolvedValue(25 as never);
    vi.mocked(prisma.group.findMany).mockResolvedValue([groupRow()] as never);
    return request(app).get(`/api/v1/groups${query}`).set('Cookie', cookie);
  };
  const lastWhere = () => vi.mocked(prisma.group.findMany).mock.calls[0][0]!.where!;

  it('needs a signed-in user and keeps students out', async () => {
    expect((await request(app).get('/api/v1/groups')).status).toBe(401);
    expect((await request(app).get('/api/v1/groups').set('Cookie', cookieFor('STUDENT'))).status).toBe(403);
    expect((await request(app).get('/api/v1/groups').set('Cookie', cookieFor('PROCTOR'))).status).toBe(403);
  });

  it('shows an institution admin only groups of their institution', async () => {
    const res = await list(adminCookie, 'INSTITUTION_ADMIN');
    expect(res.status).toBe(200);
    expect(lastWhere()).toMatchObject({ deletedAt: null, institutionId: instA });
    expect(lastWhere()).not.toHaveProperty('course');
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 25, totalPages: 2 });
  });

  it('shows an instructor only groups of the courses they teach', async () => {
    const res = await list(instructorCookie, 'INSTRUCTOR');
    expect(res.status).toBe(200);
    expect(lastWhere()).toMatchObject({
      institutionId: instA,
      course: { deletedAt: null, instructors: { some: { userId: actor } } },
    });
  });

  it('lets a super admin see all institutions, or filter to one', async () => {
    await list(superCookie, 'SUPER_ADMIN');
    expect(lastWhere()).not.toHaveProperty('institutionId');

    resetMockDb();
    await list(superCookie, 'SUPER_ADMIN', `?institutionId=${instB}`);
    expect(lastWhere()).toMatchObject({ institutionId: instB });
  });

  it('ignores the institution filter of an institution admin', async () => {
    await list(adminCookie, 'INSTITUTION_ADMIN', `?institutionId=${instB}`);
    expect(lastWhere()).toMatchObject({ institutionId: instA });
  });

  it('applies search, course filter and paging', async () => {
    await list(adminCookie, 'INSTITUTION_ADMIN', `?q=class&courseId=${COURSE_ID}&page=2&pageSize=10&sortBy=createdAt&order=desc`);
    const args = vi.mocked(prisma.group.findMany).mock.calls[0][0]!;
    expect(args.where).toMatchObject({ courseId: COURSE_ID, name: { contains: 'class', mode: 'insensitive' } });
    expect(args.skip).toBe(10);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });
});

describe('POST /groups', () => {
  const payload = { name: 'CS101 - Class B', academicYear: '2026/27', courseId: COURSE_ID };
  const create = (body: object, cookie = adminCookie) => request(app).post('/api/v1/groups').set('Cookie', cookie).send(body);

  const mockCreate = (institutionId = instA) => {
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: institutionId, name: 'Demo', isActive: true } as never);
    courseFindFirst().mockResolvedValue({ id: COURSE_ID } as never);
    groupFindUnique().mockResolvedValue(null as never);
    vi.mocked(prisma.group.create).mockResolvedValue(groupRow({ institutionId }) as never);
  };

  it('creates a group in the admin’s institution, linked to a course of that institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();

    const res = await create(payload);

    expect(res.status).toBe(201);
    expect(courseFindFirst().mock.calls[0][0]!.where).toEqual({ id: COURSE_ID, institutionId: instA, deletedAt: null });
    expect(vi.mocked(prisma.group.create).mock.calls[0][0].data).toMatchObject({
      institutionId: instA,
      name: 'CS101 - Class B',
      courseId: COURSE_ID,
    });
  });

  it('can create a group without a course', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();

    const res = await create({ name: 'Evening Class' });

    expect(res.status).toBe(201);
    expect(courseFindFirst()).not.toHaveBeenCalled();
  });

  it('refuses a course from another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();
    courseFindFirst().mockResolvedValue(null as never);

    const res = await create(payload);

    expect(res.status).toBe(404);
    expect(prisma.group.create).not.toHaveBeenCalled();
  });

  it('refuses to create a group in another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    const res = await create({ ...payload, institutionId: instB });
    expect(res.status).toBe(403);
    expect(prisma.group.create).not.toHaveBeenCalled();
  });

  it('asks a super admin which institution', async () => {
    actingAs('SUPER_ADMIN');
    expect((await create(payload, superCookie)).status).toBe(400);
  });

  it('rejects a name that already exists in the institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();
    groupFindUnique().mockResolvedValue({ id: 'existing' } as never);

    const res = await create(payload);

    expect(res.status).toBe(409);
    expect(prisma.group.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a name with markup', { ...payload, name: '<b>x</b>' }],
    ['a too short name', { ...payload, name: 'A' }],
    ['an academic year with markup', { ...payload, academicYear: '<script>' }],
    ['unknown fields', { ...payload, members: [] }],
  ])('rejects %s', async (_label, body) => {
    actingAs('INSTITUTION_ADMIN');
    expect((await create(body)).status).toBe(400);
  });

  it('is closed to instructors', async () => {
    const res = await create(payload, instructorCookie);
    expect(res.status).toBe(403);
    expect(prisma.group.create).not.toHaveBeenCalled();
  });
});

describe('GET /groups/:id', () => {
  it('returns a group inside the scope', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);

    const res = await request(app).get(`/api/v1/groups/${GROUP_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(groupFindFirst().mock.calls[0][0]!.where).toEqual({ id: GROUP_ID, deletedAt: null, institutionId: instA });
  });

  it('hides a group from an instructor who does not teach its course', async () => {
    actingAs('INSTRUCTOR');
    groupFindFirst().mockResolvedValue(null as never);

    const res = await request(app).get(`/api/v1/groups/${GROUP_ID}`).set('Cookie', instructorCookie);

    expect(res.status).toBe(404);
    expect(groupFindFirst().mock.calls[0][0]!.where).toMatchObject({
      course: { deletedAt: null, instructors: { some: { userId: actor } } },
    });
  });

  it('answers 404 for a group of another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(null as never);
    expect((await request(app).get(`/api/v1/groups/${GROUP_ID}`).set('Cookie', adminCookie)).status).toBe(404);
  });
});

describe('PATCH and DELETE /groups/:id', () => {
  const patch = (body: object, cookie = adminCookie) =>
    request(app).patch(`/api/v1/groups/${GROUP_ID}`).set('Cookie', cookie).send(body);

  it('updates name, year and course', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);
    groupFindUnique().mockResolvedValue(null as never);
    courseFindFirst().mockResolvedValue({ id: COURSE_ID } as never);
    groupUpdate().mockResolvedValue(groupRow({ name: 'Renamed' }) as never);

    const res = await patch({ name: 'Renamed', academicYear: '2027', courseId: COURSE_ID });

    expect(res.status).toBe(200);
    expect(groupUpdate().mock.calls[0][0].data).toMatchObject({ name: 'Renamed', academicYear: '2027', courseId: COURSE_ID });
  });

  it('can unlink a group from its course', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);
    groupUpdate().mockResolvedValue(groupRow({ courseId: null, course: null }) as never);

    const res = await patch({ courseId: null });

    expect(res.status).toBe(200);
    expect(courseFindFirst()).not.toHaveBeenCalled();
    expect(groupUpdate().mock.calls[0][0].data).toMatchObject({ courseId: null });
  });

  it('refuses a course from another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);
    courseFindFirst().mockResolvedValue(null as never);

    const res = await patch({ courseId: COURSE_ID });

    expect(res.status).toBe(404);
    expect(groupUpdate()).not.toHaveBeenCalled();
  });

  it('rejects a new name that another group already uses', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);
    groupFindUnique().mockResolvedValue({ id: 'other-group' } as never);

    const res = await patch({ name: 'Taken' });

    expect(res.status).toBe(409);
    expect(groupUpdate()).not.toHaveBeenCalled();
  });

  it('cannot touch a group of another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(null as never);
    expect((await patch({ name: 'Nope' })).status).toBe(404);
    expect(groupUpdate()).not.toHaveBeenCalled();
  });

  it('is closed to instructors, and rejects empty or unknown updates', async () => {
    expect((await patch({ name: 'Nope' }, instructorCookie)).status).toBe(403);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ institutionId: instB })).status).toBe(400);
  });

  it('soft-deletes a group', async () => {
    actingAs('INSTITUTION_ADMIN');
    groupFindFirst().mockResolvedValue(groupRow() as never);
    groupUpdate().mockResolvedValue(groupRow() as never);

    const res = await request(app).delete(`/api/v1/groups/${GROUP_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect((groupUpdate().mock.calls[0][0].data as { deletedAt: Date }).deletedAt).toBeInstanceOf(Date);
    expect(prisma.group.delete).not.toHaveBeenCalled();
  });

  it('does not let an instructor delete a group', async () => {
    const res = await request(app).delete(`/api/v1/groups/${GROUP_ID}`).set('Cookie', instructorCookie);
    expect(res.status).toBe(403);
  });
});

describe('group members', () => {
  const base = `/api/v1/groups/${GROUP_ID}/members`;

  describe('GET', () => {
    const list = async (cookie: string, role: Parameters<typeof actingAs>[0], query = '') => {
      actingAs(role);
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.groupMember.count).mockResolvedValue(25 as never);
      vi.mocked(prisma.groupMember.findMany).mockResolvedValue([
        { joinedAt: new Date(), user: { id: other, email: 's@demo.example', firstName: 'S', lastName: 'One', studentNumber: 'S-1', status: 'ACTIVE' } },
      ] as never);
      return request(app).get(`${base}${query}`).set('Cookie', cookie);
    };

    it('lists the members of a group the person can see, without secrets', async () => {
      const res = await list(instructorCookie, 'INSTRUCTOR');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(groupFindFirst().mock.calls[0][0]!.where).toMatchObject({
        course: { deletedAt: null, instructors: { some: { userId: actor } } },
      });
    });

    it('searches and pages', async () => {
      await list(adminCookie, 'INSTITUTION_ADMIN', '?q=abel&page=2&pageSize=10');

      const args = vi.mocked(prisma.groupMember.findMany).mock.calls[0][0]!;
      expect(args.where).toMatchObject({ groupId: GROUP_ID, user: { deletedAt: null } });
      expect((args.where!.user as { OR: unknown[] }).OR).toHaveLength(4);
      expect(args.skip).toBe(10);
    });

    it('is closed to students', async () => {
      expect((await request(app).get(base).set('Cookie', cookieFor('STUDENT'))).status).toBe(403);
    });

    it('answers 404 for a group the person cannot see', async () => {
      actingAs('INSTRUCTOR');
      groupFindFirst().mockResolvedValue(null as never);
      expect((await request(app).get(base).set('Cookie', instructorCookie)).status).toBe(404);
    });
  });

  describe('POST (enrol students)', () => {
    const add = (body: object, cookie = adminCookie) => request(app).post(base).set('Cookie', cookie).send(body);

    it('enrols only active students of the same institution, by id', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: other, email: 'a@demo.example' }] as never);
      vi.mocked(prisma.groupMember.createMany).mockResolvedValue({ count: 1 } as never);

      const res = await add({ userIds: [other, other2, other] });

      expect(res.status).toBe(200);
      expect(vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where).toMatchObject({
        id: { in: [other, other2] },
        institutionId: instA,
        role: 'STUDENT',
        deletedAt: null,
      });
      expect(prisma.groupMember.createMany).toHaveBeenCalledWith({
        data: [{ groupId: GROUP_ID, userId: other }],
        skipDuplicates: true,
      });
      expect(res.body.data).toMatchObject({ added: 1, alreadyMembers: 0 });
      expect(res.body.data.rejected).toEqual([{ identifier: other2, reason: expect.any(String) }]);
    });

    it('enrols by email address, ignoring letter case', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: other, email: 'abel@demo.example' }] as never);
      vi.mocked(prisma.groupMember.createMany).mockResolvedValue({ count: 1 } as never);

      const res = await add({ emails: ['Abel@Demo.example', 'ghost@demo.example'] });

      expect(res.status).toBe(200);
      expect(vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where).toMatchObject({
        email: { in: ['abel@demo.example', 'ghost@demo.example'] },
        institutionId: instA,
        role: 'STUDENT',
      });
      expect(res.body.data.rejected).toEqual([{ identifier: 'ghost@demo.example', reason: expect.any(String) }]);
    });

    it('reports students who were already members', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: other, email: 'a@demo.example' }] as never);
      vi.mocked(prisma.groupMember.createMany).mockResolvedValue({ count: 0 } as never);

      const res = await add({ userIds: [other] });

      expect(res.body.data).toMatchObject({ added: 0, alreadyMembers: 1 });
    });

    it('enrols nobody when nobody is eligible', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

      const res = await add({ userIds: [other] });

      expect(res.status).toBe(200);
      expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    });

    it('needs exactly one of userIds or emails, within the limits', async () => {
      expect((await add({})).status).toBe(400);
      expect((await add({ userIds: [other], emails: ['a@demo.example'] })).status).toBe(400);
      expect((await add({ userIds: [] })).status).toBe(400);
      expect((await add({ userIds: ['nope'] })).status).toBe(400);
      expect((await add({ emails: ['not-an-email'] })).status).toBe(400);
      const tooMany = Array.from({ length: 201 }, (_, i) => `u${i}@demo.example`);
      expect((await add({ emails: tooMany })).status).toBe(400);
    });

    it('is closed to instructors', async () => {
      const res = await add({ userIds: [other] }, instructorCookie);
      expect(res.status).toBe(403);
      expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    });

    it('cannot enrol into a group of another institution', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(null as never);
      const res = await add({ userIds: [other] });
      expect(res.status).toBe(404);
      expect(prisma.groupMember.createMany).not.toHaveBeenCalled();
    });
  });

  describe('DELETE (remove a student)', () => {
    it('removes a member', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.groupMember.deleteMany).mockResolvedValue({ count: 1 } as never);

      const res = await request(app).delete(`${base}/${other}`).set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: GROUP_ID, userId: other } });
    });

    it('answers 404 when the person was not a member', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(groupRow() as never);
      vi.mocked(prisma.groupMember.deleteMany).mockResolvedValue({ count: 0 } as never);

      expect((await request(app).delete(`${base}/${other}`).set('Cookie', adminCookie)).status).toBe(404);
    });

    it('does not touch members of a group the admin cannot see', async () => {
      actingAs('INSTITUTION_ADMIN');
      groupFindFirst().mockResolvedValue(null as never);

      const res = await request(app).delete(`${base}/${other}`).set('Cookie', adminCookie);

      expect(res.status).toBe(404);
      expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('is closed to instructors', async () => {
      expect((await request(app).delete(`${base}/${other}`).set('Cookie', instructorCookie)).status).toBe(403);
    });
  });
});