import type { Mock } from 'vitest';
import { vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { sendMailInBackground } from '../../src/lib/mailer';

// Clears everything the previous test configured on the mocked database.
export function resetMockDb(): void {
  const models = [
    prisma.user,
    prisma.institution,
    prisma.refreshToken,
    prisma.emailToken,
    prisma.auditLog,
    prisma.setting,
    prisma.course,
    prisma.courseInstructor,
    prisma.group,
    prisma.groupMember,
    prisma.question,
    prisma.questionVersion,
    prisma.tag,
    prisma.questionTag,
  ];
  for (const model of models) {
    for (const fn of Object.values(model)) {
      (fn as Mock).mockReset();
    }
  }
  vi.mocked(sendMailInBackground).mockClear();
}