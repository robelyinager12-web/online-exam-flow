import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';

const app = createApp();
const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(`ExamFlow API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'Error while closing the server');
      process.exit(1);
    }
    process.exit(0);
  });
  // Force exit if connections do not close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception, shutting down');
  process.exit(1);
});