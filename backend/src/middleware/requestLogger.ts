import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    // Only trust a client-supplied id if it is a harmless token (prevents log injection).
    const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
});