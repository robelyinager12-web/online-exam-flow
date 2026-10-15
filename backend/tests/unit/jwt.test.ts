import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { signAccessToken, verifyAccessToken } from '../../src/lib/jwt';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

const valid = () =>
  signAccessToken({ userId: USER_ID, role: 'INSTRUCTOR', institutionId: INSTITUTION_ID, sessionId: SESSION_ID });

const catchError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as { statusCode: number; code: string };
  }
  throw new Error('expected the call to throw');
};

const signWith = (secret: string, claims: Record<string, unknown>, options: jwt.SignOptions = {}) =>
  jwt.sign({ institutionId: null, sid: SESSION_ID, ...claims }, secret, {
    algorithm: 'HS256',
    subject: USER_ID,
    issuer: 'examflow',
    audience: 'examflow-web',
    ...options,
  });

describe('access tokens', () => {
  it('round-trips the claims', () => {
    expect(verifyAccessToken(valid())).toMatchObject({
      sub: USER_ID,
      role: 'INSTRUCTOR',
      institutionId: INSTITUTION_ID,
      sid: SESSION_ID,
    });
  });

  it('supports a null institution for super admins', () => {
    const token = signAccessToken({ userId: USER_ID, role: 'SUPER_ADMIN', institutionId: null, sessionId: SESSION_ID });
    expect(verifyAccessToken(token).institutionId).toBeNull();
  });

  it('rejects a tampered token', () => {
    const [header, payload, signature] = valid().split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN' })).toString('base64url');
    expect(catchError(() => verifyAccessToken(`${header}.${forged}.${signature}`))).toMatchObject({
      statusCode: 401,
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects an expired token with a distinct code', () => {
    const expired = signWith(env.JWT_ACCESS_SECRET, { role: 'STUDENT' }, { expiresIn: -10 });
    expect(catchError(() => verifyAccessToken(expired))).toMatchObject({ statusCode: 401, code: 'TOKEN_EXPIRED' });
  });

  it('rejects "alg: none" tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: USER_ID, role: 'SUPER_ADMIN', institutionId: null, sid: SESSION_ID, iss: 'examflow', aud: 'examflow-web' }),
    ).toString('base64url');
    expect(catchError(() => verifyAccessToken(`${header}.${payload}.`))).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects tokens signed with a different secret', () => {
    const foreign = signWith('another-secret-another-secret-123456', { role: 'STUDENT' });
    expect(catchError(() => verifyAccessToken(foreign))).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects tokens meant for another audience', () => {
    const other = signWith(env.JWT_ACCESS_SECRET, { role: 'STUDENT' }, { audience: 'someone-else' });
    expect(catchError(() => verifyAccessToken(other))).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects an unknown role claim', () => {
    const odd = signWith(env.JWT_ACCESS_SECRET, { role: 'GOD_MODE' });
    expect(catchError(() => verifyAccessToken(odd))).toMatchObject({ code: 'INVALID_TOKEN' });
  });
});