import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actingAs, cookieFor, IDS } from '../helpers/actors';
import { resetMockDb } from '../helpers/db';

const app = createApp();
const { instA, instB, actor, other } = IDS;
const QUESTION_ID = '99999999-9999-4999-8999-999999999999';
const COURSE_ID = '77777777-7777-4777-8777-777777777777';

beforeEach(() => {
  resetMockDb();
});

const adminCookie = cookieFor('INSTITUTION_ADMIN');
const superCookie = cookieFor('SUPER_ADMIN', null);
const instructorCookie = cookieFor('INSTRUCTOR');

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: QUESTION_ID,
  institutionId: instA,
  courseId: COURSE_ID,
  authorId: actor,
  type: 'MCQ_SINGLE',
  difficulty: 'MEDIUM',
  latestVersion: 2,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  course: { id: COURSE_ID, code: 'CS101', name: 'Intro' },
  author: { id: actor, firstName: 'In', lastName: 'Structor' },
  tags: [{ tag: { name: 'loops' } }, { tag: { name: 'basics' } }],
  versions: [
    {
      version: 2,
      body: '<p>What is 2 + 2?</p>',
      options: [{ id: 'o1', text: '3' }, { id: 'o2', text: '4' }],
      answerKey: { optionIds: ['o2'] },
      rubric: null,
      explanation: null,
      points: 1,
      createdAt: new Date(),
    },
  ],
  ...overrides,
});

const q = {
  findFirst: () => vi.mocked(prisma.question.findFirst),
  create: () => vi.mocked(prisma.question.create),
  update: () => vi.mocked(prisma.question.update),
  updateMany: () => vi.mocked(prisma.question.updateMany),
  findMany: () => vi.mocked(prisma.question.findMany),
};
const versionCreate = () => vi.mocked(prisma.questionVersion.create);
const courseFindFirst = () => vi.mocked(prisma.course.findFirst);

const singleContent = {
  type: 'MCQ_SINGLE',
  body: '<p>What is 2 + 2?</p>',
  options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }],
};

describe('access control', () => {
  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/v1/questions')).status).toBe(401);
  });

  it.each(['STUDENT', 'PROCTOR'] as const)('keeps the %s role out of every endpoint', async (role) => {
    const cookie = cookieFor(role);
    expect((await request(app).get('/api/v1/questions').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get(`/api/v1/questions/${QUESTION_ID}`).set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/questions/tags').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).post('/api/v1/questions').set('Cookie', cookie).send({ content: singleContent })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/questions/${QUESTION_ID}`).set('Cookie', cookie)).status).toBe(403);
    expect(prisma.question.create).not.toHaveBeenCalled();
  });

  it('stops an instructor who was deactivated after their token was issued', async () => {
    actingAs('INSTRUCTOR', { status: 'INACTIVE' });
    expect((await request(app).get('/api/v1/questions').set('Cookie', instructorCookie)).status).toBe(401);
  });
});

describe('POST /questions', () => {
  const create = (body: object, cookie = instructorCookie) =>
    request(app).post('/api/v1/questions').set('Cookie', cookie).send(body);

  const mockCreate = (row: Record<string, unknown> = {}) => {
    courseFindFirst().mockResolvedValue({ id: COURSE_ID, institutionId: instA } as never);
    q.create().mockResolvedValue({ id: QUESTION_ID } as never);
    vi.mocked(prisma.tag.upsert).mockResolvedValue({ id: 'tag-1' } as never);
    q.findFirst().mockResolvedValue(detailRow(row) as never);
  };

  it('creates a question with its first version, tags and the author', async () => {
    actingAs('INSTRUCTOR');
    mockCreate();

    const res = await create({ content: { ...singleContent, points: 2 }, courseId: COURSE_ID, difficulty: 'HARD', tags: ['Loops', ' basics ', 'loops'] });

    expect(res.status).toBe(201);
    const data = q.create().mock.calls[0][0].data as Record<string, any>;
    expect(data).toMatchObject({ institutionId: instA, courseId: COURSE_ID, authorId: actor, type: 'MCQ_SINGLE', difficulty: 'HARD', latestVersion: 1 });
    expect(data.versions.create).toMatchObject({
      version: 1,
      points: 2,
      createdById: actor,
      options: [{ id: 'o1', text: '3' }, { id: 'o2', text: '4' }],
      answerKey: { optionIds: ['o2'] },
    });
    // tags are lower-cased and de-duplicated
    expect(prisma.tag.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tag.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { institutionId_name: { institutionId: instA, name: 'loops' } } }));
    expect(prisma.questionTag.createMany).toHaveBeenCalledOnce();
    expect(res.body.data.question.current.content.options).toEqual([
      { text: '3', isCorrect: false },
      { text: '4', isCorrect: true },
    ]);
  });

  it('lets an instructor use only a course they teach', async () => {
    actingAs('INSTRUCTOR');
    mockCreate();
    await create({ content: singleContent, courseId: COURSE_ID });
    expect(courseFindFirst().mock.calls[0][0]!.where).toMatchObject({
      id: COURSE_ID,
      institutionId: instA,
      instructors: { some: { userId: actor } },
    });

    resetMockDb();
    actingAs('INSTRUCTOR');
    courseFindFirst().mockResolvedValue(null as never);
    const res = await create({ content: singleContent, courseId: COURSE_ID });
    expect(res.status).toBe(404);
    expect(q.create()).not.toHaveBeenCalled();
  });

  it('creates a personal question when no course is given', async () => {
    actingAs('INSTRUCTOR');
    vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: instA, name: 'Demo', isActive: true } as never);
    q.create().mockResolvedValue({ id: QUESTION_ID } as never);
    q.findFirst().mockResolvedValue(detailRow({ courseId: null, course: null, tags: [] }) as never);

    const res = await create({ content: singleContent });

    expect(res.status).toBe(201);
    expect((q.create().mock.calls[0][0].data as { courseId: unknown }).courseId).toBeNull();
    expect(prisma.tag.upsert).not.toHaveBeenCalled();
  });

  it('refuses another institution, and asks a super admin for one', async () => {
    actingAs('INSTRUCTOR');
    expect((await create({ content: singleContent, institutionId: instB })).status).toBe(403);

    resetMockDb();
    actingAs('SUPER_ADMIN');
    expect((await create({ content: singleContent }, superCookie)).status).toBe(400);
    expect(q.create()).not.toHaveBeenCalled();
  });

  it('stores true/false, short answer and essay questions in their own shapes', async () => {
    const cases: [object, Record<string, unknown>][] = [
      [{ type: 'TRUE_FALSE', body: '<p>x</p>', correctAnswer: false }, { answerKey: { optionIds: ['false'] } }],
      [{ type: 'SHORT_ANSWER', body: '<p>x</p>', acceptedAnswers: ['Paris'] }, { answerKey: { accepted: ['Paris'], caseSensitive: false } }],
      [{ type: 'ESSAY', body: '<p>x</p>', points: 5, rubric: [{ criterion: 'Argument', maxPoints: 5 }] }, { rubric: [{ criterion: 'Argument', maxPoints: 5 }] }],
    ];
    for (const [content, expected] of cases) {
      resetMockDb();
      actingAs('INSTITUTION_ADMIN');
      vi.mocked(prisma.institution.findUnique).mockResolvedValue({ id: instA, name: 'Demo', isActive: true } as never);
      q.create().mockResolvedValue({ id: QUESTION_ID } as never);
      q.findFirst().mockResolvedValue(detailRow({ type: (content as { type: string }).type, tags: [] }) as never);

      const res = await create({ content }, adminCookie);

      expect(res.status).toBe(201);
      const version = (q.create().mock.calls[0][0].data as Record<string, any>).versions.create;
      expect(version).toMatchObject(expected);
    }
  });

  it('stores cleaned wording, never the script', async () => {
    actingAs('INSTRUCTOR');
    mockCreate();
    await create({ content: { ...singleContent, body: '<p>Safe</p><script>alert(1)</script>' }, courseId: COURSE_ID });
    expect((q.create().mock.calls[0][0].data as Record<string, any>).versions.create.body).toBe('<p>Safe</p>');
  });

  it.each([
    ['no correct option', { ...singleContent, options: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] }],
    ['two correct options on single choice', { ...singleContent, options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }],
    ['markup in an option', { ...singleContent, options: [{ text: '<b>a</b>', isCorrect: true }, { text: 'b', isCorrect: false }] }],
    ['empty wording', { ...singleContent, body: '<script>x</script>' }],
    ['too many points', { ...singleContent, points: 101 }],
    ['an unknown type', { type: 'MATCHING', body: '<p>x</p>' }],
  ])('rejects %s', async (_label, content) => {
    actingAs('INSTRUCTOR');
    expect((await create({ content })).status).toBe(400);
    expect(q.create()).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level fields and bad tags', async () => {
    expect((await create({ content: singleContent, authorId: other })).status).toBe(400);
    expect((await create({ content: singleContent, tags: ['<b>'] })).status).toBe(400);
    expect((await create({ content: singleContent, tags: Array(11).fill('a').map((t, i) => `${t}${i}`) })).status).toBe(400);
  });

  it('asks the user to retry when two people create the same tag at once', async () => {
    actingAs('INSTRUCTOR');
    courseFindFirst().mockResolvedValue({ id: COURSE_ID, institutionId: instA } as never);
    q.create().mockResolvedValue({ id: QUESTION_ID } as never);
    vi.mocked(prisma.tag.upsert).mockRejectedValue({ code: 'P2002' });

    const res = await create({ content: singleContent, courseId: COURSE_ID, tags: ['loops'] });

    expect(res.status).toBe(409);
  });
});

describe('GET /questions', () => {
  const list = async (query = '', cookie = instructorCookie, role: Parameters<typeof actingAs>[0] = 'INSTRUCTOR') => {
    actingAs(role);
    vi.mocked(prisma.question.count).mockResolvedValue(42 as never);
    q.findMany().mockResolvedValue([
      {
        id: QUESTION_ID,
        courseId: COURSE_ID,
        authorId: actor,
        type: 'MCQ_SINGLE',
        difficulty: 'EASY',
        latestVersion: 1,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        course: { id: COURSE_ID, code: 'CS101' },
        author: { id: actor, firstName: 'In', lastName: 'Structor' },
        tags: [{ tag: { name: 'loops' } }, { tag: { name: 'basics' } }],
        versions: [{ body: `<p>${'Long question text '.repeat(30)}</p>`, points: 2 }],
      },
    ] as never);
    return request(app).get(`/api/v1/questions${query}`).set('Cookie', cookie);
  };
  const where = () => q.findMany().mock.calls[0][0]!.where as { AND: Record<string, any>[] };

  it('combines the person’s scope with the filters, and hides archived questions by default', async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(where().AND[0]).toMatchObject({
      deletedAt: null,
      institutionId: instA,
      OR: [{ authorId: actor }, { course: { deletedAt: null, instructors: { some: { userId: actor } } } }],
    });
    expect(where().AND[1]).toEqual({ isArchived: false });
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 42, totalPages: 3 });
  });

  it('shows an institution admin the whole institution', async () => {
    await list('', adminCookie, 'INSTITUTION_ADMIN');
    expect(where().AND[0]).toEqual({ deletedAt: null, institutionId: instA });
  });

  it('returns previews and points but never the answers', async () => {
    const res = await list();

    const item = res.body.data[0];
    expect(item.preview.length).toBeLessThanOrEqual(200);
    expect(item.preview.startsWith('Long question text')).toBe(true);
    expect(item.points).toBe(2);
    expect(item.tags).toEqual(['basics', 'loops']);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('answerKey');
    expect(text).not.toContain('isCorrect');
    expect(text).not.toContain('options');
  });

  it('applies every filter', async () => {
    await list(`?type=TRUE_FALSE&difficulty=HARD&courseId=${COURSE_ID}&tag=Loops&q=loop&mine=true&archived=only`);
    expect(where().AND[1]).toEqual({
      isArchived: true,
      type: 'TRUE_FALSE',
      difficulty: 'HARD',
      courseId: COURSE_ID,
      authorId: actor,
      tags: { some: { tag: { name: 'loops' } } },
      versions: { some: { body: { contains: 'loop', mode: 'insensitive' } } },
    });
  });

  it('can include archived questions', async () => {
    await list('?archived=include');
    expect(where().AND[1]).not.toHaveProperty('isArchived');
  });

  it('pages and sorts', async () => {
    await list('?page=3&pageSize=10&sortBy=difficulty&order=asc');
    const args = q.findMany().mock.calls[0][0]!;
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual([{ difficulty: 'asc' }, { id: 'asc' }]);
  });

  it('lets a super admin filter by institution but nobody else', async () => {
    await list(`?institutionId=${instB}`, superCookie, 'SUPER_ADMIN');
    expect(where().AND[1]).toMatchObject({ institutionId: instB });

    resetMockDb();
    await list(`?institutionId=${instB}`, adminCookie, 'INSTITUTION_ADMIN');
    expect(where().AND[1]).not.toHaveProperty('institutionId');
  });

  it('rejects bad parameters', async () => {
    for (const query of ['?pageSize=500', '?type=NOPE', '?hack=1', '?tag=%3Cb%3E']) {
      expect((await list(query)).status).toBe(400);
    }
  });
});

describe('GET /questions/:id and versions', () => {
  const get = (path = '', cookie = instructorCookie) => request(app).get(`/api/v1/questions/${QUESTION_ID}${path}`).set('Cookie', cookie);

  it('returns the current version in the editor shape, with the answers, for staff', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);

    const res = await get();

    expect(res.status).toBe(200);
    const question = res.body.data.question;
    expect(question.tags).toEqual(['basics', 'loops']);
    expect(question.current.version).toBe(2);
    expect(question.current.content).toMatchObject({
      type: 'MCQ_SINGLE',
      options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }],
    });
    expect(q.findFirst().mock.calls[0][0]!.where).toMatchObject({ id: QUESTION_ID, deletedAt: null, institutionId: instA });
  });

  it('answers 404 for a question outside the scope', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(null as never);
    expect((await get()).status).toBe(404);
  });

  it('lists the versions of a question', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    vi.mocked(prisma.questionVersion.findMany).mockResolvedValue([
      { version: 2, points: 1, createdAt: new Date(), createdBy: { id: actor, firstName: 'In', lastName: 'Structor' } },
      { version: 1, points: 1, createdAt: new Date(), createdBy: { id: actor, firstName: 'In', lastName: 'Structor' } },
    ] as never);

    const res = await get('/versions');

    expect(res.status).toBe(200);
    expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(vi.mocked(prisma.questionVersion.findMany).mock.calls[0][0]!.where).toEqual({ questionId: QUESTION_ID });
  });

  it('reads one old version, and answers 404 for a missing one', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    vi.mocked(prisma.questionVersion.findFirst).mockResolvedValue({
      version: 1,
      body: '<p>Old wording</p>',
      options: [{ id: 'o1', text: '3' }, { id: 'o2', text: '4' }],
      answerKey: { optionIds: ['o1'] },
      rubric: null,
      explanation: null,
      points: 1,
      createdAt: new Date(),
    } as never);
    const found = await get('/versions/1');
    expect(found.status).toBe(200);
    expect(found.body.data.version.content.body).toBe('<p>Old wording</p>');
    expect(found.body.data.version.content.options[0].isCorrect).toBe(true);

    resetMockDb();
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    vi.mocked(prisma.questionVersion.findFirst).mockResolvedValue(null as never);
    expect((await get('/versions/9')).status).toBe(404);
  });

  it('rejects a version number that is not a positive whole number', async () => {
    expect((await get('/versions/0')).status).toBe(400);
    expect((await get('/versions/abc')).status).toBe(400);
  });
});

describe('PATCH /questions/:id', () => {
  const patch = (body: object, cookie = instructorCookie) =>
    request(app).patch(`/api/v1/questions/${QUESTION_ID}`).set('Cookie', cookie).send(body);

  const newContent = {
    type: 'MCQ_SINGLE',
    body: '<p>What is 3 + 3?</p>',
    options: [{ text: '5', isCorrect: false }, { text: '6', isCorrect: true }],
  };

  it('changes only metadata without creating a version', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    vi.mocked(prisma.tag.upsert).mockResolvedValue({ id: 'tag-9' } as never);

    const res = await patch({ difficulty: 'HARD', isArchived: true, tags: ['New Tag'] });

    expect(res.status).toBe(200);
    expect(versionCreate()).not.toHaveBeenCalled();
    expect(q.updateMany()).not.toHaveBeenCalled();
    expect(q.update()).toHaveBeenCalledWith({ where: { id: QUESTION_ID }, data: { difficulty: 'HARD', courseId: undefined, isArchived: true } });
    expect(prisma.questionTag.deleteMany).toHaveBeenCalledWith({ where: { questionId: QUESTION_ID } });
    expect(prisma.tag.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { institutionId_name: { institutionId: instA, name: 'new tag' } } }));
  });

  it('creates a new immutable version when the content changes', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    q.updateMany().mockResolvedValue({ count: 1 } as never);

    const res = await patch({ content: newContent, baseVersion: 2 });

    expect(res.status).toBe(200);
    expect(q.updateMany()).toHaveBeenCalledWith({ where: { id: QUESTION_ID, latestVersion: 2 }, data: { latestVersion: 3 } });
    expect(versionCreate().mock.calls[0][0].data).toMatchObject({
      questionId: QUESTION_ID,
      version: 3,
      createdById: actor,
      options: [{ id: 'o1', text: '5' }, { id: 'o2', text: '6' }],
      answerKey: { optionIds: ['o2'] },
    });
    // an old version is never rewritten or removed
    expect(prisma.questionVersion.update).not.toHaveBeenCalled();
    expect(prisma.questionVersion.deleteMany).not.toHaveBeenCalled();
    const actions = vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0].data as { action: string }).action);
    expect(actions).toContain('question.new_version');
  });

  it('refuses to overwrite a newer edit (stale base version)', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);

    const res = await patch({ content: newContent, baseVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
    expect(res.body.error.details).toEqual({ latestVersion: 2 });
    expect(versionCreate()).not.toHaveBeenCalled();
  });

  it('loses gracefully when a colleague saved at the same moment', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    q.updateMany().mockResolvedValue({ count: 0 } as never);

    const res = await patch({ content: newContent, baseVersion: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
    expect(versionCreate()).not.toHaveBeenCalled();
  });

  it('treats a database uniqueness collision as "try again"', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    q.updateMany().mockResolvedValue({ count: 1 } as never);
    versionCreate().mockRejectedValue({ code: 'P2002' });

    expect((await patch({ content: newContent, baseVersion: 2 })).status).toBe(409);
  });

  it('never changes the question type', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);

    const res = await patch({ content: { type: 'TRUE_FALSE', body: '<p>x</p>', correctAnswer: true }, baseVersion: 2 });

    expect(res.status).toBe(400);
    expect(versionCreate()).not.toHaveBeenCalled();
  });

  it('needs the base version whenever the content changes', async () => {
    expect((await patch({ content: newContent })).status).toBe(400);
  });

  it('lets only the author or an administrator change a question', async () => {
    const someoneElses = detailRow({ authorId: other });

    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(someoneElses as never);
    expect((await patch({ difficulty: 'EASY' })).status).toBe(403);
    expect(q.update()).not.toHaveBeenCalled();

    resetMockDb();
    actingAs('INSTITUTION_ADMIN');
    q.findFirst().mockResolvedValue(someoneElses as never);
    expect((await patch({ difficulty: 'EASY' }, adminCookie)).status).toBe(200);
  });

  it('moves a question to another course only if the person may use it', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    courseFindFirst().mockResolvedValue(null as never);
    expect((await patch({ courseId: IDS.other2 })).status).toBe(404);
    expect(q.update()).not.toHaveBeenCalled();

    resetMockDb();
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);
    courseFindFirst().mockResolvedValue({ id: IDS.other2, institutionId: instA } as never);
    expect((await patch({ courseId: IDS.other2 })).status).toBe(200);
    expect(q.update().mock.calls[0][0].data).toMatchObject({ courseId: IDS.other2 });
  });

  it('can unlink a question from its course', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);

    expect((await patch({ courseId: null })).status).toBe(200);
    expect(q.update().mock.calls[0][0].data).toMatchObject({ courseId: null });
    expect(courseFindFirst()).not.toHaveBeenCalled();
  });

  it('never moves a question into a course of another institution', async () => {
    actingAs('SUPER_ADMIN');
    q.findFirst().mockResolvedValue(detailRow() as never);
    courseFindFirst().mockResolvedValue({ id: IDS.other2, institutionId: instB } as never);

    expect((await patch({ courseId: IDS.other2 }, superCookie)).status).toBe(400);
    expect(q.update()).not.toHaveBeenCalled();
  });

  it('answers 404 outside the scope, and rejects empty or unknown updates', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(null as never);
    expect((await patch({ difficulty: 'EASY' })).status).toBe(404);

    expect((await patch({})).status).toBe(400);
    expect((await patch({ authorId: other })).status).toBe(400);
    expect((await patch({ type: 'ESSAY' })).status).toBe(400);
  });
});

describe('DELETE /questions/:id', () => {
  const remove = (cookie = instructorCookie) => request(app).delete(`/api/v1/questions/${QUESTION_ID}`).set('Cookie', cookie);

  it('soft-deletes the question and keeps its versions', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow() as never);

    const res = await remove();

    expect(res.status).toBe(200);
    expect((q.update().mock.calls[0][0].data as { deletedAt: Date }).deletedAt).toBeInstanceOf(Date);
    expect(prisma.question.delete).not.toHaveBeenCalled();
    expect(prisma.questionVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('lets only the author or an administrator delete', async () => {
    actingAs('INSTRUCTOR');
    q.findFirst().mockResolvedValue(detailRow({ authorId: other }) as never);
    expect((await remove()).status).toBe(403);
    expect(q.update()).not.toHaveBeenCalled();

    resetMockDb();
    actingAs('INSTITUTION_ADMIN');
    q.findFirst().mockResolvedValue(detailRow({ authorId: other }) as never);
    expect((await remove(adminCookie)).status).toBe(200);
  });

  it('answers 404 outside the scope', async () => {
    actingAs('INSTITUTION_ADMIN');
    q.findFirst().mockResolvedValue(null as never);
    expect((await remove(adminCookie)).status).toBe(404);
    expect(q.update()).not.toHaveBeenCalled();
  });
});

describe('GET /questions/tags', () => {
  const tags = async (query = '', cookie = instructorCookie, role: Parameters<typeof actingAs>[0] = 'INSTRUCTOR') => {
    actingAs(role);
    vi.mocked(prisma.tag.findMany).mockResolvedValue([
      { id: 't1', name: 'basics', _count: { questions: 7 } },
      { id: 't2', name: 'loops', _count: { questions: 3 } },
    ] as never);
    return request(app).get(`/api/v1/questions/tags${query}`).set('Cookie', cookie);
  };

  it('lists the tags of the person’s institution with their usage', async () => {
    const res = await tags('?q=lo');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 't1', name: 'basics', questionCount: 7 },
      { id: 't2', name: 'loops', questionCount: 3 },
    ]);
    expect(vi.mocked(prisma.tag.findMany).mock.calls[0][0]!.where).toEqual({
      institutionId: instA,
      name: { contains: 'lo', mode: 'insensitive' },
    });
  });

  it('needs an institution for a super admin, and refuses other institutions for everyone else', async () => {
    expect((await tags('', superCookie, 'SUPER_ADMIN')).status).toBe(400);

    resetMockDb();
    expect((await tags(`?institutionId=${instB}`, superCookie, 'SUPER_ADMIN')).status).toBe(200);
    expect(vi.mocked(prisma.tag.findMany).mock.calls[0][0]!.where).toMatchObject({ institutionId: instB });

    resetMockDb();
    expect((await tags(`?institutionId=${instB}`, adminCookie, 'INSTITUTION_ADMIN')).status).toBe(403);
  });
});