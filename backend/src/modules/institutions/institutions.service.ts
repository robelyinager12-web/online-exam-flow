import type { Prisma } from '@prisma/client';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/appError';
import type { RequestContext } from '../../lib/http';
import { buildPageMeta, toSkipTake } from '../../lib/pagination';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../audit/audit.service';
import { sendInvite, unusablePassword } from '../users/users.service';
import { mergeSettings, type UpdateSettingsInput } from './institutions.settings';
import type { CreateInstitutionInput, ListInstitutionsQuery, UpdateInstitutionInput } from './institutions.validation';

const institutionSelect = {
  id: true,
  name: true,
  slug: true,
  contactEmail: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InstitutionSelect;

type InstitutionView = Prisma.InstitutionGetPayload<{ select: typeof institutionSelect }>;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

function assertSuperAdmin(actor: Actor): void {
  if (actor.role !== 'SUPER_ADMIN') {
    throw AppError.forbidden();
  }
}

// An institution admin or instructor can only reach their own institution. Any other id looks
// exactly like an institution that does not exist.
async function findAccessible(actor: Actor, id: string): Promise<InstitutionView> {
  if (actor.role !== 'SUPER_ADMIN' && actor.institutionId !== id) {
    throw AppError.notFound('Institution not found');
  }
  const institution = await prisma.institution.findUnique({ where: { id }, select: institutionSelect });
  if (!institution) {
    throw AppError.notFound('Institution not found');
  }
  return institution;
}

const audit = (
  actor: Actor,
  ctx: RequestContext,
  action: string,
  institutionId: string,
  metadata?: Prisma.InputJsonObject,
) =>
  recordAudit({
    actorId: actor.id,
    institutionId,
    action,
    entityType: 'institution',
    entityId: institutionId,
    metadata,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

// ---------------------------------------------------------------- queries

export async function listInstitutions(actor: Actor, query: ListInstitutionsQuery) {
  assertSuperAdmin(actor);

  const where: Prisma.InstitutionWhereInput = {};
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, items] = await prisma.$transaction([
    prisma.institution.count({ where }),
    prisma.institution.findMany({
      where,
      select: { ...institutionSelect, _count: { select: { users: true } } },
      orderBy: [{ [query.sortBy]: query.order } as Prisma.InstitutionOrderByWithRelationInput, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ]);

  return { items, meta: buildPageMeta(query, total) };
}

export const getInstitution = (actor: Actor, id: string) => findAccessible(actor, id);

export async function getCurrentInstitution(actor: Actor) {
  if (!actor.institutionId) {
    throw AppError.notFound('This account does not belong to an institution');
  }
  return findAccessible(actor, actor.institutionId);
}

// ---------------------------------------------------------------- create

export async function createInstitution(actor: Actor, input: CreateInstitutionInput, ctx: RequestContext) {
  assertSuperAdmin(actor);

  if (input.admin) {
    const emailTaken = await prisma.user.findUnique({ where: { email: input.admin.email }, select: { id: true } });
    if (emailTaken) {
      throw AppError.conflict('A user with the administrator’s email address already exists');
    }
  }
  const slugTaken = await prisma.institution.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (slugTaken) {
    throw AppError.conflict('An institution with this slug already exists');
  }

  let created;
  try {
    // The institution and its first admin are created together or not at all.
    created = await prisma.$transaction(async (tx) => {
      const institution = await tx.institution.create({
        data: { name: input.name, slug: input.slug, contactEmail: input.contactEmail },
        select: institutionSelect,
      });
      const admin = input.admin
        ? await tx.user.create({
            data: {
              institutionId: institution.id,
              email: input.admin.email,
              passwordHash: unusablePassword(),
              firstName: input.admin.firstName,
              lastName: input.admin.lastName,
              role: 'INSTITUTION_ADMIN',
              status: 'PENDING_VERIFICATION',
            },
            select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true },
          })
        : null;
      return { institution, admin };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('The slug or the administrator’s email address is already in use');
    }
    throw error;
  }

  if (created.admin) {
    await sendInvite(created.admin, created.institution.name);
  }
  await audit(actor, ctx, 'institution.create', created.institution.id, {
    slug: created.institution.slug,
    firstAdminCreated: created.admin !== null,
  });
  return created;
}

// ---------------------------------------------------------------- update

export async function updateInstitution(actor: Actor, id: string, input: UpdateInstitutionInput, ctx: RequestContext) {
  const current = await findAccessible(actor, id);

  if (actor.role !== 'SUPER_ADMIN' && (input.slug !== undefined || input.isActive !== undefined)) {
    throw AppError.forbidden('Only a super admin can change the slug or the active state');
  }

  if (input.slug && input.slug !== current.slug) {
    const slugTaken = await prisma.institution.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (slugTaken) {
      throw AppError.conflict('An institution with this slug already exists');
    }
  }

  let updated: InstitutionView;
  try {
    updated = await prisma.institution.update({
      where: { id },
      data: { name: input.name, slug: input.slug, contactEmail: input.contactEmail, isActive: input.isActive },
      select: institutionSelect,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict('An institution with this slug already exists');
    }
    throw error;
  }

  if (input.isActive === false && current.isActive) {
    // Everyone of the institution is signed out right away.
    await prisma.refreshToken.updateMany({
      where: { user: { institutionId: id }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(actor, ctx, 'institution.deactivate', id);
  } else if (input.isActive === true && !current.isActive) {
    await audit(actor, ctx, 'institution.reactivate', id);
  }
  await audit(actor, ctx, 'institution.update', id, {
    fields: Object.keys(input).filter((key) => key !== 'isActive'),
  });
  return updated;
}

// ---------------------------------------------------------------- settings

export async function getSettings(actor: Actor, id: string) {
  await findAccessible(actor, id);
  const rows = await prisma.setting.findMany({ where: { institutionId: id }, select: { key: true, value: true } });
  return mergeSettings(rows);
}

export async function updateSettings(actor: Actor, id: string, input: UpdateSettingsInput, ctx: RequestContext) {
  await findAccessible(actor, id);

  const entries = Object.entries(input).filter(([, value]) => value !== undefined) as [string, Prisma.InputJsonValue][];
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { institutionId_key: { institutionId: id, key } },
        update: { value },
        create: { institutionId: id, key, value },
      }),
    ),
  );

  await audit(actor, ctx, 'settings.update', id, { keys: entries.map(([key]) => key) });
  const rows = await prisma.setting.findMany({ where: { institutionId: id }, select: { key: true, value: true } });
  return mergeSettings(rows);
}