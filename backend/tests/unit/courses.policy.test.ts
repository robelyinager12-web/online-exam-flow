import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/lib/actor';
import { courseScope } from '../../src/modules/courses/courses.policy';

const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const actor = (role: Actor['role'], institutionId: string | null = INSTITUTION): Actor => ({ id: 'u1', role, institutionId });

describe('courseScope', () => {
  it('lets a super admin see every course that is not deleted', () => {
    expect(courseScope(actor('SUPER_ADMIN', null))).toEqual({ deletedAt: null });
  });

  it('limits an institution admin to their institution', () => {
    expect(courseScope(actor('INSTITUTION_ADMIN'))).toEqual({ deletedAt: null, institutionId: INSTITUTION });
  });

  it('limits an instructor to the courses they are assigned to', () => {
    expect(courseScope(actor('INSTRUCTOR'))).toEqual({
      deletedAt: null,
      institutionId: INSTITUTION,
      instructors: { some: { userId: 'u1' } },
    });
  });

  it('gives students and proctors no access', () => {
    expect(() => courseScope(actor('STUDENT'))).toThrow();
    expect(() => courseScope(actor('PROCTOR'))).toThrow();
  });

  it('refuses anyone below super admin who has no institution', () => {
    expect(() => courseScope(actor('INSTITUTION_ADMIN', null))).toThrow();
    expect(() => courseScope(actor('INSTRUCTOR', null))).toThrow();
  });
});