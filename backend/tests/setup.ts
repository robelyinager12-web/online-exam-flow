import { vi } from 'vitest';

// Runs before every test file, before any application module is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://examflow:examflow_dev_password@localhost:5432/examflow_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.ALLOW_SELF_REGISTRATION = 'true';
process.env.APP_URL = 'http://localhost:5173';

// Unit and API tests never touch a real database or mail server.
// Tests set the return values they need on these mocks.
vi.mock('../src/lib/prisma', () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });

  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(),
    user: model(),
    institution: model(),
    refreshToken: model(),
    emailToken: model(),
    auditLog: model(),
  };

  // Supports both forms: $transaction([...promises]) and $transaction(async (tx) => ...)
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as unknown[]),
  );

  return { prisma };
});

vi.mock('../src/lib/mailer', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  sendMailInBackground: vi.fn(),
}));