import env from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import app from './app.js';
import logger from './utils/logger.js';
import { startJobs, stopJobs } from './jobs/index.js';

const start = async () => {
  try {
    await connectDB();
    startJobs();

    const server = app.listen(env.port, () => {
      logger.info(`${'ElevIQ SFA'} API server listening on :${env.port} [${env.nodeEnv}]`);
      logger.info(`API docs: http://localhost:${env.port}/api-docs`);
    });

    // ---- Graceful shutdown -------------------------------------------
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      stopJobs();
      server.close(async () => {
        await disconnectDB();
        logger.info('Shutdown complete.');
        process.exit(0);
      });
      // Force exit if shutdown hangs.
      setTimeout(() => {
        logger.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 15000).unref();
    };

    ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) => process.on(sig, () => shutdown(sig)));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason instanceof Error ? reason.stack : reason);
    });
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err.stack || err);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

start();

export default start;
