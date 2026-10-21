import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/appError';
import type { Actor } from '../../lib/actor';

// Which questions a person may see. Every question query is combined with this filter.
//  - super admin: every question
//  - institution admin: every question of their institution
//  - instructor: questions of the courses they teach, plus questions they wrote themselves
//  - everyone else: none (students never see question content or answer keys here)
export function questionScope(actor: Actor): Prisma.QuestionWhereInput {
  const notDeleted: Prisma.QuestionWhereInput = { deletedAt: null };

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
      OR: [
        { authorId: actor.id },
        { course: { deletedAt: null, instructors: { some: { userId: actor.id } } } },
      ],
    };
  }
  throw AppError.forbidden();
}

// Seeing a question is not the same as changing it. Co-teachers can read and use each other's
// questions, but only the author (or an administrator) can edit, archive or delete one.
export function canModifyQuestion(actor: Actor, question: { authorId: string }): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'INSTITUTION_ADMIN') return true;
  return actor.role === 'INSTRUCTOR' && question.authorId === actor.id;
}