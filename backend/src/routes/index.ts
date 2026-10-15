import { Router } from 'express';

export const apiRouter = Router();

// Liveness check for load balancers, Docker and uptime monitors.
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

// Feature routers are mounted here as each module is built:
// apiRouter.use('/auth', authRouter);