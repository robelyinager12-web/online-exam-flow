import type { Prisma } from '@prisma/client';
import { resolveTenant, type Actor } from '../../lib/actor';
import { AppError } from '../../lib/appError';
import type { RequestContext } from '../../lib/http';
import { buildPageMeta, toSkipTake } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { htmlToPlainText } from '../../lib/sanitize';
import { recordAudit } from '../audit/audit.service';
import { courseScope } from '../courses/courses.policy';
import { buildVersionData, versionToContent } from './questions.content';
import { canModifyQuestion, questionScope } from './questions.policy';
import type {
  CreateQuestionInput,
  ListQuestionsQuery,
  ListTagsQuery,
  QuestionContentInput,
  UpdateQuestionInput,
} from './questions.validation';

// ---------------------------------------------------------------- what the API returns

const detailSelect = {
  id: true,
  institutionId: true,
  courseId: true,
  authorId: true,
  type: true,
  difficulty: true,
  latestVersion: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true } },
  author: { select: { id: true, firstName: true, lastName: true } },
  tags: { select: { tag: { select: { name: true } } } },
  versions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: {
      version: true,
      body: true,
      options: true,
      answerKey: true,
      rubric: true,
      explanation: true,
      points: true,
      createdAt: true,
    },
  },
} satisfies Prisma.QuestionSelect;

type QuestionDetailRow = Prisma.QuestionGetPayload<{ select: typeof detailSelect }>;

const listSelect = {
  id: true,
  courseId: true,
  authorId: true,
  type: true,
  difficulty: true,
  latestVersion: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true } },
  author: { select: { id: true, firstName: true, lastName: true } },
  tags: { select: { tag: { select: { name: true } } } },
  versions: { orderBy: { version: 'desc' }, take: 1, select: { body: true, points: true } },
} satisfies Prisma.QuestionSelect;

// Full view for one question: includes the answers, so it is for staff only.
function toDetailView(row: QuestionDetailRow) {
  const { versions, tags, ...rest } = row;
  const current = versions[0];
  return {
    ...rest,
    tags: tags.map((entry) => entry.tag.name).sort(),
    current: current ? { version: current.version, createdAt: current.createdAt, content: versionToContent(row.type, current) } : null,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

// ---------------------------------------------------------------- helpers

// Two people creating the same new tag at the same moment can collide in the database.
// That is a harmless race, so the caller is simply asked to try again.
const simultaneousChange = () => AppError.conflict('Another change happened at the same moment. Please try again.');

// A question outside the person's scope looks exactly like a question that does not exist.
async function findInScope(actor: Actor, id: string): Promise<QuestionDetailRow> {
  const question = await prisma.question.findFirst({
    where: { id, ...questionScope(actor) },
    select: detailSelect,
  });
  if (!question) {
    throw AppError.notFound('Question not found');
  }
  return question;
}

// Which institution (and course) a question belongs to. An instructor can only pick a course they teach.
async function resolveHome(
  actor: Actor,
  input: { courseId?: string | null; institutionId?: string },
): Promise<{ institutionId: string; courseId: string | null }> {
  if (actor.role !== 'SUPER_ADMIN' && input.institutionId && input.institutionId !== actor.institutionId) {
    throw AppError.forbidden('You can only work inside your own institution');
  }

  if (input.courseId) {
    const course = await prisma.course.findFirst({
      where: { id: input.courseId, ...courseScope(actor) },
      select: { id: true, institutionId: true },
    });
    if (!course) {
      throw AppError.notFound('Course not found');
    }
    if (input.institutionId && input.institutionId !== course.institutionId) {
      throw AppError.badRequest('The course belongs to a different institution');
    }
    return { institutionId: course.institutionId, courseId: course.id };
  }

  const tenant = await resolveTenant(actor, input.institutionId);
  return { institutionId: tenant.id, courseId: null };
}

// Makes the question carry exactly these tags, creating tags that do not exist yet.
async function syncTags(tx: Prisma.TransactionClient, institutionId: string, questionId: string, names: string[]) {
  const tags = await Promise.all(
    names.map((name) =>
      tx.tag.upsert({
        where: { institutionId_name: { institutionId, name } },
        update: {},
        create: { institutionId, name },
        select: { id: true },
      }),
    ),
  );
  await tx.questionTag.deleteMany({ where: { questionId } });
  if (tags.length > 0) {
    await tx.questionTag.createMany({ data: tags.map((tag) => ({ questionId, tagId: tag.id })) });
  }
}

// Creates a question together with its first version. Shared with the CSV import (next step).
export async function persistNewQuestion(
  actorId: string,
  data: {
    institutionId: string;
    courseId: string | null;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    content: QuestionContentInput;
    tags: string[];
  },
): Promise<string> {
  const version = buildVersionData(data.content);

  return prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        institutionId: data.institutionId,
        courseId: data.courseId,
        authorId: actorId,
        type: data.content.type,
        difficulty: data.difficulty,
        latestVersion: 1,
        versions: {
          create: {
            version: 1,
            body: version.body,
            options: version.options,
            answerKey: version.answerKey,
            rubric: version.rubric,
            explanation: version.explanation,
            points: version.points,
            createdById: actorId,
          },
        },
      },
      select: { id: true },
    });
    await syncTags(tx, data.institutionId, question.id, data.tags);
    return question.id;
  });
}

const audit = (
  actor: Actor,
  ctx: RequestContext,
  action: string,
  question: { id: string; institutionId: string },
  metadata?: Prisma.InputJsonObject,
) =>
  recordAudit({
    actorId: actor.id,
    institutionId: question.institutionId,
    action,
    entityType: 'question',
    entityId: question.id,
    metadata,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

// ---------------------------------------------------------------- create

export async function createQuestion(actor: Actor, input: CreateQuestionInput, ctx: RequestContext) {
  const home = await resolveHome(actor, input);

  let id: string;
  try {
    id = await persistNewQuestion(actor.id, {
      institutionId: home.institutionId,
      courseId: home.courseId,
      difficulty: input.difficulty,
      content: input.content,
      tags: input.tags,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw simultaneousChange();
    throw error;
  }

  const created = await findInScope(actor, id);
  await audit(actor, ctx, 'question.create', created, { type: created.type });
  return toDetailView(created);
}

// ---------------------------------------------------------------- list / read

function buildFilters(actor: Actor, query: ListQuestionsQuery): Prisma.QuestionWhereInput {
  const filters: Prisma.QuestionWhereInput = {};

  if (actor.role === 'SUPER_ADMIN' && query.institutionId) filters.institutionId = query.institutionId;
  if (query.archived === 'exclude') filters.isArchived = false;
  if (query.archived === 'only') filters.isArchived = true;
  if (query.type) filters.type = query.type;
  if (query.difficulty) filters.difficulty = query.difficulty;
  if (query.courseId) filters.courseId = query.courseId;
  if (query.mine) filters.authorId = actor.id;
  if (query.tag) filters.tags = { some: { tag: { name: query.tag } } };
  // Searches the wording of every version of the question.
  if (query.q) filters.versions = { some: { body: { contains: query.q, mode: 'insensitive' } } };

  return filters;
}

export async function listQuestions(actor: Actor, query: ListQuestionsQuery) {
  // The scope has its own OR, so scope and filters are combined with AND instead of spread together.
  const where: Prisma.QuestionWhereInput = { AND: [questionScope(actor), buildFilters(actor, query)] };

  const [total, rows] = await prisma.$transaction([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      select: listSelect,
      orderBy: [{ [query.sortBy]: query.order } as Prisma.QuestionOrderByWithRelationInput, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  // The list shows a short plain-text preview. Answers are only in the single-question view.
  const items = rows.map(({ versions, tags, ...rest }) => ({
    ...rest,
    tags: tags.map((entry) => entry.tag.name).sort(),
    preview: versions[0] ? htmlToPlainText(versions[0].body).slice(0, 200) : '',
    points: versions[0] ? Number(versions[0].points) : null,
  }));

  return { items, meta: buildPageMeta(query, total) };
}

export async function getQuestion(actor: Actor, id: string) {
  return toDetailView(await findInScope(actor, id));
}

export async function listVersions(actor: Actor, id: string) {
  const question = await findInScope(actor, id);
  const versions = await prisma.questionVersion.findMany({
    where: { questionId: question.id },
    select: {
      version: true,
      points: true,
      createdAt: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { version: 'desc' },
  });
  return versions.map((version) => ({ ...version, points: Number(version.points) }));
}

export async function getVersion(actor: Actor, id: string, versionNumber: number) {
  const question = await findInScope(actor, id);
  const version = await prisma.questionVersion.findFirst({
    where: { questionId: question.id, version: versionNumber },
    select: {
      version: true,
      body: true,
      options: true,
      answerKey: true,
      rubric: true,
      explanation: true,
      points: true,
      createdAt: true,
    },
  });
  if (!version) {
    throw AppError.notFound('Version not found');
  }
  return { version: version.version, createdAt: version.createdAt, content: versionToContent(question.type, version) };
}

// ---------------------------------------------------------------- update

export async function updateQuestion(actor: Actor, id: string, input: UpdateQuestionInput, ctx: RequestContext) {
  const target = await findInScope(actor, id);

  if (!canModifyQuestion(actor, target)) {
    throw AppError.forbidden('Only the author or an administrator can change this question');
  }
  if (input.content && input.content.type !== target.type) {
    throw AppError.badRequest('The question type cannot be changed. Create a new question instead.');
  }
  if (input.content && input.baseVersion !== target.latestVersion) {
    throw new AppError(
      409,
      'STALE_VERSION',
      'This question was changed by someone else. Reload it and apply your changes again.',
      { latestVersion: target.latestVersion },
    );
  }

  let courseId: string | null | undefined;
  if (input.courseId === null) {
    courseId = null;
  } else if (input.courseId) {
    const home = await resolveHome(actor, { courseId: input.courseId });
    if (home.institutionId !== target.institutionId) {
      throw AppError.badRequest('The course belongs to a different institution');
    }
    courseId = home.courseId;
  }

  const newVersion = input.content ? target.latestVersion + 1 : null;

  try {
    await prisma.$transaction(async (tx) => {
      if (input.content && newVersion !== null) {
        // Claim the next version number. If someone else got there first, nothing is written.
        const claimed = await tx.question.updateMany({
          where: { id: target.id, latestVersion: target.latestVersion },
          data: { latestVersion: newVersion },
        });
        if (claimed.count !== 1) {
          throw new AppError(409, 'STALE_VERSION', 'This question was changed by someone else. Reload it and try again.');
        }
        const version = buildVersionData(input.content);
        await tx.questionVersion.create({
          data: {
            questionId: target.id,
            version: newVersion,
            body: version.body,
            options: version.options,
            answerKey: version.answerKey,
            rubric: version.rubric,
            explanation: version.explanation,
            points: version.points,
            createdById: actor.id,
          },
        });
      }

      if (input.difficulty !== undefined || courseId !== undefined || input.isArchived !== undefined) {
        await tx.question.update({
          where: { id: target.id },
          data: { difficulty: input.difficulty, courseId, isArchived: input.isArchived },
        });
      }
      if (input.tags !== undefined) {
        await syncTags(tx, target.institutionId, target.id, input.tags);
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw simultaneousChange();
    throw error;
  }

  const fields = Object.keys(input).filter((key) => key !== 'content' && key !== 'baseVersion');
  await audit(actor, ctx, newVersion ? 'question.new_version' : 'question.update', target, {
    fields,
    ...(newVersion ? { version: newVersion } : {}),
  });
  return toDetailView(await findInScope(actor, id));
}

// ---------------------------------------------------------------- delete

export async function deleteQuestion(actor: Actor, id: string, ctx: RequestContext): Promise<void> {
  const target = await findInScope(actor, id);
  if (!canModifyQuestion(actor, target)) {
    throw AppError.forbidden('Only the author or an administrator can delete this question');
  }

  // Soft delete: exams and results that used the question keep their exact wording through the versions.
  await prisma.question.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
  await audit(actor, ctx, 'question.delete', target);
}

// ---------------------------------------------------------------- tags

export async function listTags(actor: Actor, query: ListTagsQuery) {
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'INSTITUTION_ADMIN' && actor.role !== 'INSTRUCTOR') {
    throw AppError.forbidden();
  }
  const institutionId = actor.role === 'SUPER_ADMIN' ? query.institutionId : actor.institutionId;
  if (!institutionId) {
    throw AppError.badRequest('institutionId is required');
  }
  if (actor.role !== 'SUPER_ADMIN' && query.institutionId && query.institutionId !== actor.institutionId) {
    throw AppError.forbidden('You can only work inside your own institution');
  }

  const tags = await prisma.tag.findMany({
    where: { institutionId, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}) },
    select: { id: true, name: true, _count: { select: { questions: true } } },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return tags.map((tag) => ({ id: tag.id, name: tag.name, questionCount: tag._count.questions }));
}