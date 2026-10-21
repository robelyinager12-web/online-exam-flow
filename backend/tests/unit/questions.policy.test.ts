import { describe, expect, it } from 'vitest';
import type { Actor } from '../../src/lib/actor';
import { canModifyQuestion, questionScope } from '../../src/modules/questions/questions.policy';

const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const actor = (role: Actor['role'], institutionId: string | null = INSTITUTION, id = 'u1'): Actor => ({ id, role, institutionId });

describe('questionScope', () => {
  it('lets a super admin see every question that is not deleted', () => {
    expect(questionScope(actor('SUPER_ADMIN', null))).toEqual({ deletedAt: null });
  });

  it('limits an institution admin to their institution', () => {
    expect(questionScope(actor('INSTITUTION_ADMIN'))).toEqual({ deletedAt: null, institutionId: INSTITUTION });
  });

  it('limits an instructor to their own questions and those of courses they teach', () => {
    expect(questionScope(actor('INSTRUCTOR'))).toEqual({
      deletedAt: null,
      institutionId: INSTITUTION,
      OR: [{ authorId: 'u1' }, { course: { deletedAt: null, instructors: { some: { userId: 'u1' } } } }],
    });
  });

  it('gives students and proctors no access', () => {
    expect(() => questionScope(actor('STUDENT'))).toThrow();
    expect(() => questionScope(actor('PROCTOR'))).toThrow();
  });

  it('refuses anyone below super admin who has no institution', () => {
    expect(() => questionScope(actor('INSTITUTION_ADMIN', null))).toThrow();
    expect(() => questionScope(actor('INSTRUCTOR', null))).toThrow();
  });
});

describe('canModifyQuestion', () => {
  it('lets administrators change any question', () => {
    expect(canModifyQuestion(actor('SUPER_ADMIN', null), { authorId: 'someone' })).toBe(true);
    expect(canModifyQuestion(actor('INSTITUTION_ADMIN'), { authorId: 'someone' })).toBe(true);
  });

  it('lets an instructor change only their own questions', () => {
    expect(canModifyQuestion(actor('INSTRUCTOR'), { authorId: 'u1' })).toBe(true);
    expect(canModifyQuestion(actor('INSTRUCTOR'), { authorId: 'someone-else' })).toBe(false);
  });

  it('never lets students or proctors change questions', () => {
    expect(canModifyQuestion(actor('STUDENT'), { authorId: 'u1' })).toBe(false);
    expect(canModifyQuestion(actor('PROCTOR'), { authorId: 'u1' })).toBe(false);
  });
});