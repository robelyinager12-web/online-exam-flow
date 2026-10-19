import type { Prisma } from '@prisma/client';
import { assertAdmin, resolveTenant, type Actor } from '../../lib/actor';
import { AppError } from '../../lib/appError';
import type { RequestContext } from '../../lib/http';
import { buildPageMeta, toSkipTake } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { courseScope } from './courses.policy';
import type { CreateCourseInput, ListCoursesQuery, UpdateCourseInput } from './courses.validation';

const courseSelect = {
  id: true,
  institutionId: true,
  code: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { instructors: true, groups: true } },
} satisfies Prisma.CourseSelect;

type CourseView = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

// A course outside the person's scope looks exactly like a course that does not exist.
async function findInScope(actor: Actor, id: string): Promise<CourseView> {
  const course = await prisma.course.findFirst({
    where: { id, ...courseScope(actor) },
    select: courseSelect,
  });
  if (!course) {
    throw AppError.notFound('Course not found');
  }
  return course;
}

const audit = (
  actor: Actor,
  ctx: RequestContext,
  action: string,
  course: Pick<CourseView, 'id' | 'institutionId'>,
  metadata?: Prisma.InputJsonObject,
) =>
  recordAudit({
    actorId: actor.id,
    institutionId: course.institutionId,
    action,
    entityType: 'course',
    entityId: course.id,
    metadata,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

// ---------------------------------------------------------------- queries

export async function listCourses(actor: Actor, query: ListCoursesQuery) {
  const where: Prisma.CourseWhereInput = { ...courseScope(actor) };

  if (actor.role === 'SUPER_ADMIN' && query.institutionId) where.institutionId = query.institutionId;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.q) {
    where.OR = [
      { code: { contains: query.q, mode: 'insensitive' } },
      { name: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      select: courseSelect,
      orderBy: [{ [query.sortBy]: query.order } as Prisma.CourseOrderByWithRelationInput, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  return { items, meta: buildPageMeta(query, total) };
}

export const getCourse = (actor: Actor, id: string): Promise<CourseView> => findInScope(actor, id);

// ---------------------------------------------------------------- create / update / delete

export async function createCourse(actor: Actor, input: CreateCourseInput, ctx: RequestContext): Promise<CourseView> {
  assertAdmin(actor);
  const institution = await resolveTenant(actor, input.institutionId);

  const codeTaken = await prisma.course.findUnique({
    where: { institutionId_code: { institutionId: institution.id, code: input.code } },
    select: { id: true },
  });
  if (codeTaken) {
    throw AppError.conflict('A course with this code already exists in the institution');
  }

  let created: CourseView;
  try {
    created = await prisma.course.create({
      data: {
        institutionId: institution.id,
        code: input.code,
        name: input.name,
        description: input.description,
      },
      select: courseSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('A course with this code already exists in the institution');
    }
    throw error;
  }

  await audit(actor, ctx, 'course.create', created, { code: created.code });
  return created;
}

export async function updateCourse(actor: Actor, id: string, input: UpdateCourseInput, ctx: RequestContext): Promise<CourseView> {
  assertAdmin(actor);
  const target = await findInScope(actor, id);

  if (input.code && input.code !== target.code) {
    const codeTaken = await prisma.course.findUnique({
      where: { institutionId_code: { institutionId: target.institutionId, code: input.code } },
      select: { id: true },
    });
    if (codeTaken) {
      throw AppError.conflict('A course with this code already exists in the institution');
    }
  }

  let updated: CourseView;
  try {
    updated = await prisma.course.update({
      where: { id: target.id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        isActive: input.isActive,
      },
      select: courseSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('A course with this code already exists in the institution');
    }
    throw error;
  }

  await audit(actor, ctx, 'course.update', target, { fields: Object.keys(input) });
  return updated;
}

export async function deleteCourse(actor: Actor, id: string, ctx: RequestContext): Promise<void> {
  assertAdmin(actor);
  const target = await findInScope(actor, id);

  // Soft delete: exams, questions and results that point at the course stay intact.
  await prisma.course.update({
    where: { id: target.id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await audit(actor, ctx, 'course.delete', target, { code: target.code });
}

// ---------------------------------------------------------------- instructors

export async function listInstructors(actor: Actor, courseId: string) {
  const course = await findInScope(actor, courseId);
  return prisma.courseInstructor.findMany({
    where: { courseId: course.id, user: { deletedAt: null } },
    select: {
      assignedAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
    },
    orderBy: { assignedAt: 'asc' },
  });
}

export async function addInstructors(actor: Actor, courseId: string, userIds: string[], ctx: RequestContext) {
  assertAdmin(actor);
  const course = await findInScope(actor, courseId);
  const requested = [...new Set(userIds)];

  // Only real instructors of the SAME institution can be assigned.
  const eligible = await prisma.user.findMany({
    where: {
      id: { in: requested },
      institutionId: course.institutionId,
      role: 'INSTRUCTOR',
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
    },
    select: { id: true },
  });
  const eligibleIds = eligible.map((user) => user.id);
  const rejected = requested.filter((id) => !eligibleIds.includes(id));

  const created =
    eligibleIds.length > 0
      ? await prisma.courseInstructor.createMany({
          data: eligibleIds.map((userId) => ({ courseId: course.id, userId })),
          skipDuplicates: true,
        })
      : { count: 0 };

  await audit(actor, ctx, 'course.instructors_added', course, { added: created.count, rejected: rejected.length });
  return {
    added: created.count,
    alreadyAssigned: eligibleIds.length - created.count,
    rejected: rejected.map((userId) => ({ userId, reason: 'Not an active instructor of this institution' })),
  };
}

export async function removeInstructor(actor: Actor, courseId: string, userId: string, ctx: RequestContext) {
  assertAdmin(actor);
  const course = await findInScope(actor, courseId);

  const removed = await prisma.courseInstructor.deleteMany({ where: { courseId: course.id, userId } });
  if (removed.count === 0) {
    throw AppError.notFound('This instructor is not assigned to the course');
  }
  await audit(actor, ctx, 'course.instructor_removed', course, { userId });
}