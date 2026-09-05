import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closePool, healthcheck } from './db/pool';
import { startScheduler, stopScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  const dbUp = await healthcheck();
  if (!dbUp) {
    logger.error(
      'Cannot reach PostgreSQL. Check DATABASE_URL and that the server is running, then run `npm run migrate`.',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        env: env.nodeEnv,
        razorpay: env.razorpay.enabled ? 'live' : 'mock',
        email: env.mail.enabled ? 'resend' : 'console',
        storage: env.storage.cloudinaryEnabled ? 'cloudinary' : 'local',
      },
      `Tixit API listening on ${env.apiBaseUrl}`,
    );
  });

  startScheduler();

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then close the pool. A booking transaction must never be severed
   * mid-flight by a deploy.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    stopScheduler();
    server.close(async () => {
      await closePool().catch(() => undefined);
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start the server');
  process.exit(1);
});
