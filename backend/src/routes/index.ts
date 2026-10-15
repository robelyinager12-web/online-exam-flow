import { Router } from 'express';
import { AppError } from '../lib/appError';
import { asyncHandler } from '../lib/asyncHandler';
import { prisma } from '../lib/prisma';

export const apiRouter = Router();

// Liveness: the process is up. Used by load balancers, Docker and uptime monitors.
apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

// Readiness: the process is up AND the database answers.
apiRouter.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is not reachable');
    }
    res.status(200).json({
      success: true,
      data: { status: 'ready', database: 'up', timestamp: new Date().toISOString() },
    });
  }),
);

// Feature routers are mounted here as each module is built:
// apiRouter.use('/auth', authRouter);