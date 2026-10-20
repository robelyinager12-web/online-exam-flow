import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actingAs, cookieFor, IDS } from '../helpers/actors';
import { resetMockDb } from '../helpers/db';

const app = createApp();
const { instA, actor } = IDS;

beforeEach(() => {
  resetMockDb();
});

describe('GET /me/groups', () => {
  it('shows a student only the groups they belong to', async () => {
    actingAs('STUDENT');
    vi.mocked(prisma.group.findMany).mockResolvedValue([
      { id: 'g1', name: 'CS101 - Class A', academicYear: '2026', course: { id: 'c1', code: 'CS101', name: 'Intro' } },
    ] as never);

    const res = await request(app).get('/api/v1/me/groups').set('Cookie', cookieFor('STUDENT'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(vi.mocked(prisma.group.findMany).mock.calls[0][0]!.where).toEqual({
      deletedAt: null,
      institutionId: instA,
      members: { some: { userId: actor } },
    });
  });

  it('is for students only', async () => {
    expect((await request(app).get('/api/v1/me/groups')).status).toBe(401);
    for (const role of ['INSTRUCTOR', 'INSTITUTION_ADMIN', 'PROCTOR'] as const) {
      const res = await request(app).get('/api/v1/me/groups').set('Cookie', cookieFor(role));
      expect(res.status).toBe(403);
    }
  });

  it('stops a student who was deactivated after their token was issued', async () => {
    actingAs('STUDENT', { status: 'INACTIVE' });
    const res = await request(app).get('/api/v1/me/groups').set('Cookie', cookieFor('STUDENT'));
    expect(res.status).toBe(401);
  });
});

describe('GET /me/courses', () => {
  it('shows a student the active courses of their groups', async () => {
    actingAs('STUDENT');
    vi.mocked(prisma.course.findMany).mockResolvedValue([{ id: 'c1', code: 'CS101', name: 'Intro', description: null }] as never);

    const res = await request(app).get('/api/v1/me/courses').set('Cookie', cookieFor('STUDENT'));

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.course.findMany).mock.calls[0][0]!.where).toEqual({
      deletedAt: null,
      isActive: true,
      institutionId: instA,
      groups: { some: { deletedAt: null, members: { some: { userId: actor } } } },
    });
  });

  it('shows an instructor the active courses they teach', async () => {
    actingAs('INSTRUCTOR');
    vi.mocked(prisma.course.findMany).mockResolvedValue([] as never);

    const res = await request(app).get('/api/v1/me/courses').set('Cookie', cookieFor('INSTRUCTOR'));

    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.course.findMany).mock.calls[0][0]!.where).toEqual({
      deletedAt: null,
      isActive: true,
      institutionId: instA,
      instructors: { some: { userId: actor } },
    });
  });

  it('is closed to other roles', async () => {
    for (const role of ['INSTITUTION_ADMIN', 'PROCTOR', 'SUPER_ADMIN'] as const) {
      const res = await request(app).get('/api/v1/me/courses').set('Cookie', cookieFor(role, role === 'SUPER_ADMIN' ? null : instA));
      expect(res.status).toBe(403);
    }
  });
});