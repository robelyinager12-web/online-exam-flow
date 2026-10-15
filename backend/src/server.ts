import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';

const app = createApp();
const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(`ExamFlow API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  // Force exit if connections do not close in time.
  setTimeout(() => process.exit(1), 10_000).unref();

  server.close(async (error) => {
    if (error) {
      logger.error({ err: error }, 'Error while closing the server');
    }
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      logger.error({ err: disconnectError }, 'Error while closing the database connection');
    }
    process.exit(error ? 1 : 0);
  });
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