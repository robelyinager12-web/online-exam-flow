import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/lib/actor';
import { groupScope } from '../../src/modules/groups/groups.policy';

const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const actor = (role: Actor['role'], institutionId: string | null = INSTITUTION): Actor => ({ id: 'u1', role, institutionId });

describe('groupScope', () => {
  it('lets a super admin see every group that is not deleted', () => {
    expect(groupScope(actor('SUPER_ADMIN', null))).toEqual({ deletedAt: null });
  });

  it('limits an institution admin to their institution', () => {
    expect(groupScope(actor('INSTITUTION_ADMIN'))).toEqual({ deletedAt: null, institutionId: INSTITUTION });
  });

  it('limits an instructor to groups of the courses they teach', () => {
    expect(groupScope(actor('INSTRUCTOR'))).toEqual({
      deletedAt: null,
      institutionId: INSTITUTION,
      course: { deletedAt: null, instructors: { some: { userId: 'u1' } } },
    });
  });

  it('gives students and proctors no access to the group list', () => {
    expect(() => groupScope(actor('STUDENT'))).toThrow();
    expect(() => groupScope(actor('PROCTOR'))).toThrow();
  });

  it('refuses anyone below super admin who has no institution', () => {
    expect(() => groupScope(actor('INSTITUTION_ADMIN', null))).toThrow();
    expect(() => groupScope(actor('INSTRUCTOR', null))).toThrow();
  });
});