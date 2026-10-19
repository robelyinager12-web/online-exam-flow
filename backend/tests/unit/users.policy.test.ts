import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/modules/users/users.policy';
import { assertCanAssignRole, canAssignRole, scopeWhere } from '../../src/modules/users/users.policy';

const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const superAdmin: Actor = { id: 'a', role: 'SUPER_ADMIN', institutionId: null };
const institutionAdmin: Actor = { id: 'b', role: 'INSTITUTION_ADMIN', institutionId: INSTITUTION };

describe('scopeWhere (tenant isolation)', () => {
  it('limits an institution admin to their own institution', () => {
    expect(scopeWhere(institutionAdmin)).toEqual({ institutionId: INSTITUTION });
  });

  it('does not limit a super admin', () => {
    expect(scopeWhere(superAdmin)).toEqual({});
  });

  it('refuses an institution admin who has no institution', () => {
    expect(() => scopeWhere({ id: 'c', role: 'INSTITUTION_ADMIN', institutionId: null })).toThrow();
  });
});

describe('role assignment', () => {
  it('lets a super admin assign every role', () => {
    for (const role of ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR', 'PROCTOR', 'STUDENT'] as const) {
      expect(canAssignRole(superAdmin, role)).toBe(true);
    }
  });

  it('never lets an institution admin create a super admin', () => {
    expect(canAssignRole(institutionAdmin, 'SUPER_ADMIN')).toBe(false);
    expect(() => assertCanAssignRole(institutionAdmin, 'SUPER_ADMIN')).toThrow();
  });

  it('lets an institution admin assign institution-level roles', () => {
    for (const role of ['INSTITUTION_ADMIN', 'INSTRUCTOR', 'PROCTOR', 'STUDENT'] as const) {
      expect(canAssignRole(institutionAdmin, role)).toBe(true);
    }
  });
});