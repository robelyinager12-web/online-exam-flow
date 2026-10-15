import type { CorsOptions } from 'cors';
import { AppError } from '../lib/appError';
import { env } from './env';

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (curl, server-to-server, health checks) are allowed.
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(AppError.forbidden('Origin not allowed by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
};