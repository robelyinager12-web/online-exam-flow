import { vi } from 'vitest';

// Runs before every test file, before any application module is imported.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://examflow:examflow_dev_password@localhost:5432/examflow_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';

// Unit and API tests never touch a real database. Tests that need specific
// database behaviour override these mocks.
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));