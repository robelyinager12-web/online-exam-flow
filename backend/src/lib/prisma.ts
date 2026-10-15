import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env';

// One shared client per process. The global cache prevents duplicate connection
// pools when the dev server reloads modules.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}