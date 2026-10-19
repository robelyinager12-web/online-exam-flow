import type { Prisma } from '@prisma/client';
import { authConfig } from '../../config/auth';
import { logger } from '../../config/logger';
import type { RoleName } from '../../config/roles';
import { inviteUserEmail } from '../../emails/inviteUser';
import { AppError } from '../../lib/appError';
import { sendMailInBackground } from '../../lib/mailer';
import { buildPageMeta, toSkipTake } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { generateToken } from '../../lib/tokens';
import { recordAudit } from '../audit/audit.service';
import { buildAppLink, issueEmailToken } from '../auth/auth.tokens';
import { revokeAllSessionsForUser, type RequestContext } from '../auth/auth.sessions';
import { parseCsv, importRowSchema } from './users.import';
import { assertCanAssignRole, canAssignRole, scopeWhere, type Actor } from './users.policy';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.validation';

// What an admin may see about a user. The password hash is never selected.
const adminSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  institutionId: true,
  studentNumber: true,
  phone: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type AdminUser = Prisma.UserGetPayload<{ select: typeof adminSelect }>;

export interface ImportRowResult {
  row: number; // data row number (the header line is not counted)
  email: string | null;
  status: 'created' | 'ready' | 'skipped' | 'error';
  message?: string;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

// Invited users get a password nobody knows. It is not a valid hash, so no login can ever match it.
// They choose their own password through the emailed link.
const unusablePassword = (): string => `!${generateToken()}`;

// ---------------------------------------------------------------- actor

// Admin actions re-check the database instead of trusting the 15-minute access token:
// a deactivated or demoted admin loses power immediately.
export async function loadActor(userId: string): Promise<Actor> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      institutionId: true,
      deletedAt: true,
      institution: { select: { isActive: true } },
    },
  });

  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Invalid session');
  }
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'INSTITUTION_ADMIN') {
    throw AppError.forbidden();
  }
  if (user.role === 'INSTITUTION_ADMIN' && (!user.institutionId || user.institution?.isActive === false)) {
    throw AppError.forbidden();
  }
  return { id: user.id, role: user.role, institutionId: user.institutionId };
}

// ---------------------------------------------------------------- helpers

// A user outside the actor's scope looks exactly like a user that does not exist.
async function findInScope(actor: Actor, id: string): Promise<AdminUser> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null, ...scopeWhere(actor) },
    select: adminSelect,
  });
  if (!user) {
    throw AppError.notFound('User not found');
  }
  return user;
}

async function resolveInstitution(
  actor: Actor,
  role: RoleName,
  requestedId: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (role === 'SUPER_ADMIN') {
    if (requestedId) {
      throw AppError.badRequest('SUPER_ADMIN accounts do not belong to an institution');
    }
    return null;
  }

  if (actor.role !== 'SUPER_ADMIN' && requestedId && requestedId !== actor.institutionId) {
    throw AppError.forbidden('You can only manage users of your own institution');
  }
  const institutionId = actor.role === 'SUPER_ADMIN' ? requestedId : actor.institutionId;
  if (!institutionId) {
    throw AppError.badRequest('institutionId is required');
  }

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, name: true, isActive: true },
  });
  if (!institution || !institution.isActive) {
    throw AppError.notFound('Institution not found');
  }
  return { id: institution.id, name: institution.name };
}

// Never leave an institution without an active administrator.
async function assertNotLastAdmin(target: AdminUser): Promise<void> {
  if (target.role !== 'INSTITUTION_ADMIN' || target.status !== 'ACTIVE' || !target.institutionId) {
    return;
  }
  const otherAdmins = await prisma.user.count({
    where: {
      institutionId: target.institutionId,
      role: 'INSTITUTION_ADMIN',
      status: 'ACTIVE',
      deletedAt: null,
      id: { not: target.id },
    },
  });
  if (otherAdmins === 0) {
    throw new AppError(409, 'LAST_ADMIN', 'This is the last active administrator of the institution');
  }
}

async function assertStudentNumberFree(institutionId: string | null, studentNumber: string, exceptUserId?: string) {
  if (!institutionId) return;
  const taken = await prisma.user.findFirst({
    where: { institutionId, studentNumber, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true },
  });
  if (taken) {
    throw AppError.conflict('This student number is already used in the institution');
  }
}

// Sends the "set your password" link. Returns false when an invitation was sent a moment ago.
async function sendInvite(
  user: { id: string; email: string; firstName: string },
  institutionName: string | null,
): Promise<boolean> {
  const token = await issueEmailToken(user.id, 'PASSWORD_RESET', authConfig.inviteTokenTtlMs);
  if (!token) return false;
  sendMailInBackground({
    to: user.email,
    ...inviteUserEmail({
      firstName: user.firstName,
      institutionName,
      url: buildAppLink('/reset-password', token),
    }),
  });
  return true;
}

const audit = (actor: Actor, ctx: RequestContext, action: string, target: Pick<AdminUser, 'id' | 'institutionId'>, metadata?: Prisma.InputJsonObject) =>
  recordAudit({
    actorId: actor.id,
    institutionId: target.institutionId,
    action,
    entityType: 'user',
    entityId: target.id,
    metadata,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

// ---------------------------------------------------------------- queries

export async function listUsers(actor: Actor, query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = { deletedAt: null, ...scopeWhere(actor) };

  if (actor.role === 'SUPER_ADMIN' && query.institutionId) where.institutionId = query.institutionId;
  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;
  if (query.q) {
    where.OR = [
      { email: { contains: query.q, mode: 'insensitive' } },
      { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } },
      { studentNumber: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: adminSelect,
      // The id is a tiebreaker so pages never repeat or skip rows.
      orderBy: [{ [query.sortBy]: query.order } as Prisma.UserOrderByWithRelationInput, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  return { items, meta: buildPageMeta(query, total) };
}

export const getUser = (actor: Actor, id: string): Promise<AdminUser> => findInScope(actor, id);

// ---------------------------------------------------------------- create

export async function createUser(actor: Actor, input: CreateUserInput, ctx: RequestContext): Promise<AdminUser> {
  assertCanAssignRole(actor, input.role);
  const institution = await resolveInstitution(actor, input.role, input.institutionId);

  const emailTaken = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (emailTaken) {
    throw AppError.conflict('A user with this email address already exists');
  }
  if (input.studentNumber) {
    await assertStudentNumberFree(institution?.id ?? null, input.studentNumber);
  }

  let created: AdminUser;
  try {
    created = await prisma.user.create({
      data: {
        institutionId: institution?.id ?? null,
        email: input.email,
        passwordHash: unusablePassword(),
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        studentNumber: input.studentNumber,
        phone: input.phone,
        status: 'PENDING_VERIFICATION',
      },
      select: adminSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('A user with this email address or student number already exists');
    }
    throw error;
  }

  await sendInvite(created, institution?.name ?? null);
  await audit(actor, ctx, 'user.create', created, { role: created.role });
  return created;
}

// ---------------------------------------------------------------- update

export async function updateUser(actor: Actor, id: string, input: UpdateUserInput, ctx: RequestContext): Promise<AdminUser> {
  const target = await findInScope(actor, id);
  const roleChanges = input.role !== undefined && input.role !== target.role;

  if (roleChanges) {
    const newRole = input.role as RoleName;
    if (target.id === actor.id) {
      throw AppError.forbidden('You cannot change your own role');
    }
    if (target.role === 'SUPER_ADMIN' || newRole === 'SUPER_ADMIN') {
      throw AppError.forbidden('SUPER_ADMIN accounts cannot be created or changed through role changes');
    }
    assertCanAssignRole(actor, newRole);
    await assertNotLastAdmin(target);
  }

  if (input.studentNumber && input.studentNumber !== target.studentNumber) {
    await assertStudentNumberFree(target.institutionId, input.studentNumber, target.id);
  }

  let updated: AdminUser;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        studentNumber: input.studentNumber,
        role: roleChanges ? input.role : undefined,
      },
      select: adminSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('This student number is already used in the institution');
    }
    throw error;
  }

  if (roleChanges) {
    // The old role may still sit in a live access token, so every session is ended.
    await revokeAllSessionsForUser(target.id);
    await audit(actor, ctx, 'user.role_change', target, { from: target.role, to: updated.role });
  }
  await audit(actor, ctx, 'user.update', target, { fields: Object.keys(input).filter((key) => key !== 'role') });
  return updated;
}

// ------------------------------------------------- deactivate / reactivate / delete

export async function deactivateUser(actor: Actor, id: string, ctx: RequestContext): Promise<AdminUser> {
  const target = await findInScope(actor, id);
  if (target.id === actor.id) {
    throw AppError.forbidden('You cannot deactivate your own account');
  }
  if (target.status === 'INACTIVE') {
    return target;
  }
  await assertNotLastAdmin(target);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status: 'INACTIVE' },
    select: adminSelect,
  });
  await revokeAllSessionsForUser(target.id);
  await audit(actor, ctx, 'user.deactivate', target);
  return updated;
}

export async function reactivateUser(actor: Actor, id: string, ctx: RequestContext): Promise<AdminUser> {
  const target = await findInScope(actor, id);
  if (target.status !== 'INACTIVE' && target.status !== 'SUSPENDED') {
    throw AppError.conflict('This user is not deactivated');
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    // Someone who never confirmed their email goes back to "pending", not straight to "active".
    data: {
      status: target.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    select: adminSelect,
  });
  await audit(actor, ctx, 'user.reactivate', target);
  return updated;
}

export async function deleteUser(actor: Actor, id: string, ctx: RequestContext): Promise<void> {
  const target = await findInScope(actor, id);
  if (target.id === actor.id) {
    throw AppError.forbidden('You cannot delete your own account');
  }
  await assertNotLastAdmin(target);

  // Soft delete: attempts, grades and audit history keep pointing at the user.
  await prisma.user.update({
    where: { id: target.id },
    data: { deletedAt: new Date(), status: 'INACTIVE' },
  });
  await revokeAllSessionsForUser(target.id);
  await audit(actor, ctx, 'user.delete', target);
}

export async function resendInvite(actor: Actor, id: string, ctx: RequestContext): Promise<void> {
  const target = await findInScope(actor, id);
  if (target.status !== 'PENDING_VERIFICATION') {
    throw AppError.conflict('This user has already activated their account');
  }

  const institution = target.institutionId
    ? await prisma.institution.findUnique({ where: { id: target.institutionId }, select: { name: true } })
    : null;

  const sent = await sendInvite(target, institution?.name ?? null);
  if (!sent) {
    throw new AppError(429, 'INVITE_THROTTLED', 'An invitation was just sent. Please wait a minute before sending another.');
  }
  await audit(actor, ctx, 'user.invite_resent', target);
}

// ---------------------------------------------------------------- CSV import

export async function importUsers(
  actor: Actor,
  file: Buffer,
  options: { dryRun: boolean; institutionId?: string },
  ctx: RequestContext,
) {
  const institution = await resolveInstitution(actor, 'STUDENT', options.institutionId);
  if (!institution) {
    throw AppError.badRequest('institutionId is required');
  }

  const rawRows = await parseCsv(file);
  const parsed = rawRows.map((raw, index) => ({ row: index + 1, raw, result: importRowSchema.safeParse(raw) }));

  const emails = parsed.flatMap((item) => (item.result.success ? [item.result.data.email] : []));
  const studentNumbers = parsed.flatMap((item) =>
    item.result.success && item.result.data.studentNumber ? [item.result.data.studentNumber] : [],
  );

  const existingEmails = new Set(
    (await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((u) => u.email),
  );
  const existingNumbers = new Set<string | null>(
    studentNumbers.length > 0
      ? (
          await prisma.user.findMany({
            where: { institutionId: institution.id, studentNumber: { in: studentNumbers } },
            select: { studentNumber: true },
          })
        ).map((u) => u.studentNumber)
      : [],
  );

  const seenEmails = new Set<string>();
  const seenNumbers = new Set<string>();
  const rows: ImportRowResult[] = [];

  for (const { row, raw, result } of parsed) {
    if (!result.success) {
      const message = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      rows.push({ row, email: raw.email ?? null, status: 'error', message });
      continue;
    }

    const data = result.data;
    if (seenEmails.has(data.email)) {
      rows.push({ row, email: data.email, status: 'error', message: 'Duplicate email address in this file' });
      continue;
    }
    seenEmails.add(data.email);

    if (existingEmails.has(data.email)) {
      rows.push({ row, email: data.email, status: 'skipped', message: 'A user with this email address already exists' });
      continue;
    }
    if (data.role === 'SUPER_ADMIN' || !canAssignRole(actor, data.role)) {
      rows.push({ row, email: data.email, status: 'error', message: `You are not allowed to import the role ${data.role}` });
      continue;
    }
    if (data.studentNumber) {
      if (seenNumbers.has(data.studentNumber) || existingNumbers.has(data.studentNumber)) {
        rows.push({ row, email: data.email, status: 'error', message: 'Student number is already in use' });
        continue;
      }
      seenNumbers.add(data.studentNumber);
    }

    if (options.dryRun) {
      rows.push({ row, email: data.email, status: 'ready' });
      continue;
    }

    try {
      const created = await prisma.user.create({
        data: {
          institutionId: institution.id,
          email: data.email,
          passwordHash: unusablePassword(),
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          studentNumber: data.studentNumber,
          status: 'PENDING_VERIFICATION',
        },
        select: { id: true, email: true, firstName: true },
      });
      await sendInvite(created, institution.name);
      rows.push({ row, email: data.email, status: 'created' });
    } catch (error) {
      if (isUniqueViolation(error)) {
        rows.push({ row, email: data.email, status: 'skipped', message: 'Email address or student number already exists' });
      } else {
        logger.error({ err: error, row }, 'User import: could not create a row');
        rows.push({ row, email: data.email, status: 'error', message: 'This user could not be created' });
      }
    }
  }

  const count = (status: ImportRowResult['status']) => rows.filter((r) => r.status === status).length;
  const summary = {
    total: rows.length,
    created: count('created'),
    readyToCreate: count('ready'),
    skipped: count('skipped'),
    failed: count('error'),
    dryRun: options.dryRun,
  };

  if (!options.dryRun) {
    await recordAudit({
      actorId: actor.id,
      institutionId: institution.id,
      action: 'user.import',
      entityType: 'institution',
      entityId: institution.id,
      metadata: { created: summary.created, skipped: summary.skipped, failed: summary.failed },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  return { summary, rows };
}