import { vi } from 'vitest';
import type { RoleName } from '../../src/config/roles';
import { signAccessToken } from '../../src/lib/jwt';
import { prisma } from '../../src/lib/prisma';

export const IDS = {
  instA: '22222222-2222-4222-8222-222222222222',
  instB: '44444444-4444-4444-8444-444444444444',
  actor: '11111111-1111-4111-8111-111111111111',
  session: '33333333-3333-4333-8333-333333333333',
  other: '55555555-5555-4555-8555-555555555555',
  other2: '66666666-6666-4666-8666-666666666666',
};

// A signed access token for a request. The role inside it is only a first gate:
// the real checks use the database row set up by `actingAs`.
export const cookieFor = (role: RoleName, institutionId: string | null = IDS.instA, userId = IDS.actor) =>
  `ef_access=${signAccessToken({ userId, role, institutionId, sessionId: IDS.session })}`;

// The database row that the "who is acting" check finds for the next request.
export function actingAs(role: RoleName = 'INSTITUTION_ADMIN', overrides: Record<string, unknown> = {}) {
  const row = {
    id: IDS.actor,
    role,
    status: 'ACTIVE',
    institutionId: role === 'SUPER_ADMIN' ? null : IDS.instA,
    deletedAt: null,
    institution: { isActive: true },
    ...overrides,
  };
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(row as never);
}