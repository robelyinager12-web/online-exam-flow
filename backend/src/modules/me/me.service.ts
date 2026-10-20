import { AppError } from '../../lib/appError';
import type { Actor } from '../../lib/actor';
import { prisma } from '../../lib/prisma';

const courseSummary = { id: true, code: true, name: true, description: true } as const;

// The groups a student belongs to, with the course each one is linked to.
export async function myGroups(actor: Actor) {
  if (actor.role !== 'STUDENT' || !actor.institutionId) {
    throw AppError.forbidden();
  }
  return prisma.group.findMany({
    where: { deletedAt: null, institutionId: actor.institutionId, members: { some: { userId: actor.id } } },
    select: {
      id: true,
      name: true,
      academicYear: true,
      course: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 200,
  });
}

// Students: the active courses of their groups. Instructors: the courses they teach.
export async function myCourses(actor: Actor) {
  if (!actor.institutionId) {
    throw AppError.forbidden();
  }
  const base = { deletedAt: null, isActive: true, institutionId: actor.institutionId };

  if (actor.role === 'STUDENT') {
    return prisma.course.findMany({
      where: { ...base, groups: { some: { deletedAt: null, members: { some: { userId: actor.id } } } } },
      select: courseSummary,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  }
  if (actor.role === 'INSTRUCTOR') {
    return prisma.course.findMany({
      where: { ...base, instructors: { some: { userId: actor.id } } },
      select: courseSummary,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  }
  throw AppError.forbidden();
}