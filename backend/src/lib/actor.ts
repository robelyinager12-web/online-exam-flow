import type { Request } from 'express';
import type { RoleName } from '../config/roles';
import { AppError } from './appError';
import { prisma } from './prisma';

// The signed-in person performing an action, loaded fresh from the database.
export interface Actor {
  id: string;
  role: RoleName;
  institutionId: string | null;
}

// Business actions re-check the database instead of trusting the 15-minute access token:
// a deactivated user, or a user of a deactivated institution, is stopped immediately.
export async function loadActiveUser(userId: string): Promise<Actor> {
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
  if (user.role !== 'SUPER_ADMIN' && (!user.institutionId || user.institution?.isActive === false)) {
    throw AppError.forbidden();
  }
  return { id: user.id, role: user.role, institutionId: user.institutionId };
}

export async function actorFromRequest(req: Request): Promise<Actor> {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return loadActiveUser(req.user.id);
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'SUPER_ADMIN' || actor.role === 'INSTITUTION_ADMIN';

export function assertAdmin(actor: Actor): void {
  if (!isAdmin(actor)) {
    throw AppError.forbidden();
  }
}

// Decides which institution a new record belongs to. An institution admin always works inside
// their own institution; a super admin must say which one.
export async function resolveTenant(
  actor: Actor,
  requestedInstitutionId?: string,
): Promise<{ id: string; name: string }> {
  if (actor.role !== 'SUPER_ADMIN' && requestedInstitutionId && requestedInstitutionId !== actor.institutionId) {
    throw AppError.forbidden('You can only work inside your own institution');
  }
  const institutionId = actor.role === 'SUPER_ADMIN' ? requestedInstitutionId : actor.institutionId;
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