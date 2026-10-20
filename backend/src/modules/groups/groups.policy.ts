import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/appError';
import type { Actor } from '../../lib/actor';

// Which groups a person may see. Every group query is combined with this filter.
//  - super admin: every group
//  - institution admin: every group of their institution
//  - instructor: only groups that belong to a course they are assigned to
//  - everyone else: none (students see their own groups through /me/groups)
export function groupScope(actor: Actor): Prisma.GroupWhereInput {
  const notDeleted: Prisma.GroupWhereInput = { deletedAt: null };

  if (actor.role === 'SUPER_ADMIN') {
    return notDeleted;
  }
  if (!actor.institutionId) {
    throw AppError.forbidden();
  }
  if (actor.role === 'INSTITUTION_ADMIN') {
    return { ...notDeleted, institutionId: actor.institutionId };
  }
  if (actor.role === 'INSTRUCTOR') {
    return {
      ...notDeleted,
      institutionId: actor.institutionId,
      course: { deletedAt: null, instructors: { some: { userId: actor.id } } },
    };
  }
  throw AppError.forbidden();
}