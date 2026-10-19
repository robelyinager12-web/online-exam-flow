import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actingAs, cookieFor, IDS } from '../helpers/actors';
import { resetMockDb } from '../helpers/db';

const app = createApp();
const { instA, instB, actor, other, other2 } = IDS;
const COURSE_ID = '77777777-7777-4777-8777-777777777777';

beforeEach(() => {
  resetMockDb();
});

const adminCookie = cookieFor('INSTITUTION_ADMIN');
const superCookie = cookieFor('SUPER_ADMIN', null);
const instructorCookie = cookieFor('INSTRUCTOR');

const courseRow = (overrides: Record<string, unknown> = {}) => ({
  id: COURSE_ID,
  institutionId: instA,
  code: 'CS101',
  name: 'Introduction to Computer Science',
  description: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { instructors: 1, groups: 2 },
  ...overrides,
});

const courseFindFirst = () => vi.mocked(prisma.course.findFirst);
const courseFindUnique = () => vi.mocked(prisma.course.findUnique);
const courseUpdate = () => vi.mocked(prisma.course.update);

describe('GET /courses', () => {
  const list = async (cookie: string, role: Parameters<typeof actingAs>[0], query = '') => {
    actingAs(role);
    vi.mocked(prisma.course.count).mockResolvedValue(12 as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([courseRow()] as never);
    return request(app).get(`/api/v1/courses${query}`).set('Cookie', cookie);
  };
  const lastWhere = () => vi.mocked(prisma.course.findMany).mock.calls[0][0]!.where!;

  it('needs a signed-in user and keeps students out', async () => {
    expect((await request(app).get('/api/v1/courses')).status).toBe(401);
    expect((await request(app).get('/api/v1/courses').set('Cookie', cookieFor('STUDENT'))).status).toBe(403);
    expect((await request(app).get('/api/v1/courses').set('Cookie', cookieFor('PROCTOR'))).status).toBe(403);
  });

  it('shows an institution admin only courses of their institution', async () => {
    const res = await list(adminCookie, 'INSTITUTION_ADMIN');
    expect(res.status).toBe(200);
    expect(lastWhere()).toMatchObject({ deletedAt: null, institutionId: instA });
    expect(lastWhere()).not.toHaveProperty('instructors');
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 12, totalPages: 1 });
  });

  it('shows an instructor only the courses they are assigned to', async () => {
    const res = await list(instructorCookie, 'INSTRUCTOR');
    expect(res.status).toBe(200);
    expect(lastWhere()).toMatchObject({
      deletedAt: null,
      institutionId: instA,
      instructors: { some: { userId: actor } },
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

  it('applies search, filter and paging', async () => {
    await list(adminCookie, 'INSTITUTION_ADMIN', '?q=cs&isActive=false&page=2&pageSize=5&sortBy=name&order=desc');
    const args = vi.mocked(prisma.course.findMany).mock.calls[0][0]!;
    expect(args.where).toMatchObject({ isActive: false });
    expect(args.where!.OR).toHaveLength(2);
    expect(args.skip).toBe(5);
    expect(args.orderBy).toEqual([{ name: 'desc' }, { id: 'asc' }]);
  });
});

describe('POST /courses', () => {
  const payload = { code: ' cs-201 ', name: 'Data Structures', description: 'Lists, trees and graphs' };
  const create = (body: object, cookie = adminCookie) => request(app).post('/api/v1/courses').set('Cookie', cookie).send(body);

  const mockCreate = (institutionId = instA) => {
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: institutionId, name: 'Demo', isActive: true } as never);
    courseFindUnique().mockResolvedValue(null as never);
    vi.mocked(prisma.course.create).mockResolvedValue(courseRow({ code: 'CS-201', institutionId }) as never);
  };

  it('creates a course in the admin’s institution with a normalized code', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();

    const res = await create(payload);

    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.course.create).mock.calls[0][0].data).toMatchObject({
      institutionId: instA,
      code: 'CS-201',
      name: 'Data Structures',
    });
  });

  it('refuses to create a course in another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    const res = await create({ ...payload, institutionId: instB });
    expect(res.status).toBe(403);
    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it('asks a super admin which institution, then creates there', async () => {
    actingAs('SUPER_ADMIN');
    expect((await create(payload, superCookie)).status).toBe(400);

    resetMockDb();
    actingAs('SUPER_ADMIN');
    mockCreate(instB);
    const res = await create({ ...payload, institutionId: instB }, superCookie);
    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.course.create).mock.calls[0][0].data).toMatchObject({ institutionId: instB });
  });

  it('rejects a code that already exists in the institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    mockCreate();
    courseFindUnique().mockResolvedValue({ id: 'existing' } as never);

    const res = await create(payload);

    expect(res.status).toBe(409);
    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a code with spaces inside', { ...payload, code: 'CS 201' }],
    ['a name with markup', { ...payload, name: '<script>x</script>' }],
    ['a description with markup', { ...payload, description: '<img src=x>' }],
    ['unknown fields', { ...payload, isActive: false }],
  ])('rejects %s', async (_label, body) => {
    actingAs('INSTITUTION_ADMIN');
    expect((await create(body)).status).toBe(400);
  });

  it('is closed to instructors', async () => {
    const res = await create(payload, instructorCookie);
    expect(res.status).toBe(403);
    expect(prisma.course.create).not.toHaveBeenCalled();
  });
});

describe('GET /courses/:id', () => {
  it('returns a course inside the scope', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);

    const res = await request(app).get(`/api/v1/courses/${COURSE_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(courseFindFirst().mock.calls[0][0]!.where).toEqual({ id: COURSE_ID, deletedAt: null, institutionId: instA });
  });

  it('hides a course from an instructor who is not assigned to it', async () => {
    actingAs('INSTRUCTOR');
    courseFindFirst().mockResolvedValue(null as never);

    const res = await request(app).get(`/api/v1/courses/${COURSE_ID}`).set('Cookie', instructorCookie);

    expect(res.status).toBe(404);
    expect(courseFindFirst().mock.calls[0][0]!.where).toMatchObject({ instructors: { some: { userId: actor } } });
  });

  it('answers 404 for a course of another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(null as never);
    const res = await request(app).get(`/api/v1/courses/${COURSE_ID}`).set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('rejects an id that is not a UUID', async () => {
    const res = await request(app).get('/api/v1/courses/nope').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

describe('PATCH and DELETE /courses/:id', () => {
  const patch = (body: object, cookie = adminCookie) =>
    request(app).patch(`/api/v1/courses/${COURSE_ID}`).set('Cookie', cookie).send(body);

  it('updates a course', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    courseFindUnique().mockResolvedValue(null as never);
    courseUpdate().mockResolvedValue(courseRow({ name: 'Renamed', code: 'CS102' }) as never);

    const res = await patch({ name: 'Renamed', code: 'cs102', isActive: false });

    expect(res.status).toBe(200);
    expect(courseUpdate().mock.calls[0][0].data).toMatchObject({ name: 'Renamed', code: 'CS102', isActive: false });
  });

  it('rejects a new code that another course already uses', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    courseFindUnique().mockResolvedValue({ id: 'other-course' } as never);

    const res = await patch({ code: 'CS999' });

    expect(res.status).toBe(409);
    expect(courseUpdate()).not.toHaveBeenCalled();
  });

  it('cannot update a course of another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(null as never);
    expect((await patch({ name: 'Nope' })).status).toBe(404);
    expect(courseUpdate()).not.toHaveBeenCalled();
  });

  it('is closed to instructors', async () => {
    expect((await patch({ name: 'Nope' }, instructorCookie)).status).toBe(403);
  });

  it('rejects empty updates and unknown fields', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ institutionId: instB })).status).toBe(400);
  });

  it('soft-deletes a course instead of removing it', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    courseUpdate().mockResolvedValue(courseRow() as never);

    const res = await request(app).delete(`/api/v1/courses/${COURSE_ID}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const data = courseUpdate().mock.calls[0][0].data as { deletedAt: Date; isActive: boolean };
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
    expect(prisma.course.delete).not.toHaveBeenCalled();
  });

  it('does not let an instructor delete a course', async () => {
    const res = await request(app).delete(`/api/v1/courses/${COURSE_ID}`).set('Cookie', instructorCookie);
    expect(res.status).toBe(403);
  });
});

describe('course instructors', () => {
  const base = `/api/v1/courses/${COURSE_ID}/instructors`;

  it('lists the instructors of a course the person can see', async () => {
    actingAs('INSTRUCTOR');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.courseInstructor.findMany).mockResolvedValue([
      { assignedAt: new Date(), user: { id: actor, email: 'i@demo.example', firstName: 'In', lastName: 'Structor', status: 'ACTIVE' } },
    ] as never);

    const res = await request(app).get(base).set('Cookie', instructorCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('assigns only real instructors of the same institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: other }] as never); // `other2` is not eligible
    vi.mocked(prisma.courseInstructor.createMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post(base).set('Cookie', adminCookie).send({ userIds: [other, other2, other] });

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where).toMatchObject({
      id: { in: [other, other2] },
      institutionId: instA,
      role: 'INSTRUCTOR',
      deletedAt: null,
    });
    expect(prisma.courseInstructor.createMany).toHaveBeenCalledWith({
      data: [{ courseId: COURSE_ID, userId: other }],
      skipDuplicates: true,
    });
    expect(res.body.data).toMatchObject({ added: 1, alreadyAssigned: 0 });
    expect(res.body.data.rejected).toEqual([{ userId: other2, reason: expect.any(String) }]);
  });

  it('reports instructors who were already assigned', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: other }] as never);
    vi.mocked(prisma.courseInstructor.createMany).mockResolvedValue({ count: 0 } as never);

    const res = await request(app).post(base).set('Cookie', adminCookie).send({ userIds: [other] });

    expect(res.body.data).toMatchObject({ added: 0, alreadyAssigned: 1 });
  });

  it('assigns nobody when nobody is eligible', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    const res = await request(app).post(base).set('Cookie', adminCookie).send({ userIds: [other] });

    expect(res.status).toBe(200);
    expect(prisma.courseInstructor.createMany).not.toHaveBeenCalled();
    expect(res.body.data.rejected).toHaveLength(1);
  });

  it('validates the list of ids', async () => {
    expect((await request(app).post(base).set('Cookie', adminCookie).send({ userIds: [] })).status).toBe(400);
    expect((await request(app).post(base).set('Cookie', adminCookie).send({ userIds: ['nope'] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await request(app).post(base).set('Cookie', adminCookie).send({ userIds: tooMany })).status).toBe(400);
  });

  it('is closed to instructors for changes', async () => {
    const res = await request(app).post(base).set('Cookie', instructorCookie).send({ userIds: [other] });
    expect(res.status).toBe(403);
    expect(prisma.courseInstructor.createMany).not.toHaveBeenCalled();
  });

  it('cannot assign instructors to a course of another institution', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(null as never);
    const res = await request(app).post(base).set('Cookie', adminCookie).send({ userIds: [other] });
    expect(res.status).toBe(404);
    expect(prisma.courseInstructor.createMany).not.toHaveBeenCalled();
  });

  it('removes an instructor from a course', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.courseInstructor.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await request(app).delete(`${base}/${other}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(prisma.courseInstructor.deleteMany).toHaveBeenCalledWith({ where: { courseId: COURSE_ID, userId: other } });
  });

  it('answers 404 when that person was not assigned', async () => {
    actingAs('INSTITUTION_ADMIN');
    courseFindFirst().mockResolvedValue(courseRow() as never);
    vi.mocked(prisma.courseInstructor.deleteMany).mockResolvedValue({ count: 0 } as never);

    const res = await request(app).delete(`${base}/${other}`).set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });
});