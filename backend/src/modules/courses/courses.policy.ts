import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/appError';
import type { Actor } from '../../lib/actor';

// Which courses a person may see. Every course query is combined with this filter.
//  - super admin: every course
//  - institution admin: every course of their institution
//  - instructor: only the courses they are assigned to
//  - everyone else: none (students get their own course list through their groups)
export function courseScope(actor: Actor): Prisma.CourseWhereInput {
  const notDeleted: Prisma.CourseWhereInput = { deletedAt: null };

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
      instructors: { some: { userId: actor.id } },
    };
  }
  throw AppError.forbidden();
}