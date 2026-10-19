import type { Prisma } from '@prisma/client';
import type { RoleName } from '../../config/roles';
import { AppError } from '../../lib/appError';

// The signed-in admin performing an action, loaded fresh from the database.
export interface Actor {
  id: string;
  role: RoleName;
  institutionId: string | null;
}

// Tenant isolation. Every user query is combined with this filter, so an institution admin
// can never read or change a user of another institution. A super admin sees everything.
export function scopeWhere(actor: Actor): Prisma.UserWhereInput {
  if (actor.role === 'SUPER_ADMIN') {
    return {};
  }
  if (!actor.institutionId) {
    throw AppError.forbidden();
  }
  return { institutionId: actor.institutionId };
}

// Roles an institution admin may hand out. SUPER_ADMIN can never be granted by one.
const INSTITUTION_ADMIN_ASSIGNABLE: readonly RoleName[] = ['INSTITUTION_ADMIN', 'INSTRUCTOR', 'PROCTOR', 'STUDENT'];

export function canAssignRole(actor: Actor, role: RoleName): boolean {
  if (actor.role === 'SUPER_ADMIN') return true;
  return INSTITUTION_ADMIN_ASSIGNABLE.includes(role);
}

export function assertCanAssignRole(actor: Actor, role: RoleName): void {
  if (!canAssignRole(actor, role)) {
    throw AppError.forbidden('You are not allowed to assign this role');
  }
}