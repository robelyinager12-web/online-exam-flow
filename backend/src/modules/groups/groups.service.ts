import type { Prisma } from '@prisma/client';
import { assertAdmin, resolveTenant, type Actor } from '../../lib/actor';
import { AppError } from '../../lib/appError';
import type { RequestContext } from '../../lib/http';
import { buildPageMeta, toSkipTake } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { groupScope } from './groups.policy';
import type {
  AddMembersInput,
  CreateGroupInput,
  ListGroupsQuery,
  ListMembersQuery,
  UpdateGroupInput,
} from './groups.validation';

const groupSelect = {
  id: true,
  institutionId: true,
  courseId: true,
  name: true,
  academicYear: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, name: true } },
  _count: { select: { members: true } },
} satisfies Prisma.GroupSelect;

type GroupView = Prisma.GroupGetPayload<{ select: typeof groupSelect }>;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

// A group outside the person's scope looks exactly like a group that does not exist.
async function findInScope(actor: Actor, id: string): Promise<GroupView> {
  const group = await prisma.group.findFirst({
    where: { id, ...groupScope(actor) },
    select: groupSelect,
  });
  if (!group) {
    throw AppError.notFound('Group not found');
  }
  return group;
}

// A group can only be linked to a course of its own institution.
async function assertCourseInInstitution(courseId: string, institutionId: string): Promise<void> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, institutionId, deletedAt: null },
    select: { id: true },
  });
  if (!course) {
    throw AppError.notFound('Course not found');
  }
}

async function assertNameFree(institutionId: string, name: string): Promise<void> {
  const taken = await prisma.group.findUnique({
    where: { institutionId_name: { institutionId, name } },
    select: { id: true },
  });
  if (taken) {
    throw AppError.conflict('A group with this name already exists in the institution');
  }
}

const audit = (
  actor: Actor,
  ctx: RequestContext,
  action: string,
  group: Pick<GroupView, 'id' | 'institutionId'>,
  metadata?: Prisma.InputJsonObject,
) =>
  recordAudit({
    actorId: actor.id,
    institutionId: group.institutionId,
    action,
    entityType: 'group',
    entityId: group.id,
    metadata,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

// ---------------------------------------------------------------- queries

export async function listGroups(actor: Actor, query: ListGroupsQuery) {
  const where: Prisma.GroupWhereInput = { ...groupScope(actor) };

  if (actor.role === 'SUPER_ADMIN' && query.institutionId) where.institutionId = query.institutionId;
  if (query.courseId) where.courseId = query.courseId;
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

  const [total, items] = await prisma.$transaction([
    prisma.group.count({ where }),
    prisma.group.findMany({
      where,
      select: groupSelect,
      orderBy: [{ [query.sortBy]: query.order } as Prisma.GroupOrderByWithRelationInput, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  return { items, meta: buildPageMeta(query, total) };
}

export const getGroup = (actor: Actor, id: string): Promise<GroupView> => findInScope(actor, id);

// ---------------------------------------------------------------- create / update / delete

export async function createGroup(actor: Actor, input: CreateGroupInput, ctx: RequestContext): Promise<GroupView> {
  assertAdmin(actor);
  const institution = await resolveTenant(actor, input.institutionId);

  if (input.courseId) {
    await assertCourseInInstitution(input.courseId, institution.id);
  }
  await assertNameFree(institution.id, input.name);

  let created: GroupView;
  try {
    created = await prisma.group.create({
      data: {
        institutionId: institution.id,
        name: input.name,
        academicYear: input.academicYear,
        courseId: input.courseId,
      },
      select: groupSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('A group with this name already exists in the institution');
    }
    throw error;
  }

  await audit(actor, ctx, 'group.create', created, { name: created.name });
  return created;
}

export async function updateGroup(actor: Actor, id: string, input: UpdateGroupInput, ctx: RequestContext): Promise<GroupView> {
  assertAdmin(actor);
  const target = await findInScope(actor, id);

  if (input.name && input.name !== target.name) {
    await assertNameFree(target.institutionId, input.name);
  }
  if (input.courseId) {
    await assertCourseInInstitution(input.courseId, target.institutionId);
  }

  let updated: GroupView;
  try {
    updated = await prisma.group.update({
      where: { id: target.id },
      data: { name: input.name, academicYear: input.academicYear, courseId: input.courseId },
      select: groupSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('A group with this name already exists in the institution');
    }
    throw error;
  }

  await audit(actor, ctx, 'group.update', target, { fields: Object.keys(input) });
  return updated;
}

export async function deleteGroup(actor: Actor, id: string, ctx: RequestContext): Promise<void> {
  assertAdmin(actor);
  const target = await findInScope(actor, id);

  // Soft delete: exam assignments and results that point at the group stay intact.
  await prisma.group.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
  await audit(actor, ctx, 'group.delete', target, { name: target.name });
}

// ---------------------------------------------------------------- members

export async function listMembers(actor: Actor, groupId: string, query: ListMembersQuery) {
  const group = await findInScope(actor, groupId);

  const userWhere: Prisma.UserWhereInput = { deletedAt: null };
  if (query.q) {
    userWhere.OR = [
      { email: { contains: query.q, mode: 'insensitive' } },
      { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } },
      { studentNumber: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  const where: Prisma.GroupMemberWhereInput = { groupId: group.id, user: userWhere };

  const [total, items] = await prisma.$transaction([
    prisma.groupMember.count({ where }),
    prisma.groupMember.findMany({
      where,
      select: {
        joinedAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, studentNumber: true, status: true } },
      },
      orderBy: [{ user: { lastName: 'asc' } }, { userId: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  return { items, meta: buildPageMeta(query, total) };
}

export async function addMembers(actor: Actor, groupId: string, input: AddMembersInput, ctx: RequestContext) {
  assertAdmin(actor);
  const group = await findInScope(actor, groupId);

  const byEmail = input.emails !== undefined;
  const requested = [...new Set(byEmail ? (input.emails as string[]) : (input.userIds as string[]))];

  // Only active students of the SAME institution can join a group.
  const identity: Prisma.UserWhereInput = byEmail ? { email: { in: requested } } : { id: { in: requested } };
  const eligible = await prisma.user.findMany({
    where: {
      ...identity,
      institutionId: group.institutionId,
      role: 'STUDENT',
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
    },
    select: { id: true, email: true },
  });

  const matched = new Set(eligible.map((user) => (byEmail ? user.email : user.id)));
  const rejected = requested.filter((identifier) => !matched.has(identifier));

  const created =
    eligible.length > 0
      ? await prisma.groupMember.createMany({
          data: eligible.map((user) => ({ groupId: group.id, userId: user.id })),
          skipDuplicates: true,
        })
      : { count: 0 };

  await audit(actor, ctx, 'group.members_added', group, { added: created.count, rejected: rejected.length });
  return {
    added: created.count,
    alreadyMembers: eligible.length - created.count,
    rejected: rejected.map((identifier) => ({ identifier, reason: 'Not an active student of this institution' })),
  };
}

export async function removeMember(actor: Actor, groupId: string, userId: string, ctx: RequestContext) {
  assertAdmin(actor);
  const group = await findInScope(actor, groupId);

  const removed = await prisma.groupMember.deleteMany({ where: { groupId: group.id, userId } });
  if (removed.count === 0) {
    throw AppError.notFound('This person is not a member of the group');
  }
  await audit(actor, ctx, 'group.member_removed', group, { userId });
}