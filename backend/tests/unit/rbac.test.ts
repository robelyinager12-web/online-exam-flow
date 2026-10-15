import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RoleName } from '../../src/config/roles';
import { AppError } from '../../src/lib/appError';
import { authorize } from '../../src/middleware/authorize';

function run(allowed: RoleName[], role?: RoleName) {
  const req = { user: role ? { id: 'u', role, institutionId: null, sessionId: 's' } : undefined } as unknown as Request;
  const next = vi.fn();
  authorize(...allowed)(req, {} as Response, next);
  return next.mock.calls[0][0] as AppError | undefined;
}

describe('authorize', () => {
  it('lets an allowed role through', () => {
    expect(run(['INSTRUCTOR', 'INSTITUTION_ADMIN'], 'INSTRUCTOR')).toBeUndefined();
  });

  it('forbids a role that is not listed', () => {
    const error = run(['INSTRUCTOR'], 'STUDENT');
    expect(error).toBeInstanceOf(AppError);
    expect(error?.statusCode).toBe(403);
  });

  it('has no hidden bypass for super admins', () => {
    expect(run(['INSTRUCTOR'], 'SUPER_ADMIN')?.statusCode).toBe(403);
  });

  it('answers 401 when nobody is authenticated', () => {
    expect(run(['STUDENT'])?.statusCode).toBe(401);
  });
});