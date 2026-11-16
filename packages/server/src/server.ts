// ===========================================
// Server Entry Point
// ===========================================
// Starts the Express server with graceful shutdown.

import app from './app.js';
import { config } from './config/index.js';
import logger from './lib/logger.js';
import { pool } from './lib/db.js';
import { startQueue, stopQueue } from './lib/queue.js';
import { initializeSocketIO, shutdownSocketIO } from './lib/socket.js';
import { setLogCaptureStream } from './lib/logger.js';
import { LogStreamService } from './services/log-stream.service.js';
import { PrunerSchedulerService } from './services/pruner-scheduler.service.js';
import { DeploymentService } from './services/deployment.service.js';
import { createShutdownHandler, undeployAll } from './lib/shutdown.js';
import { dataSourcePoolManager } from './services/data-source-pool-manager.js';
import { warnIfDefaultAdminPassword } from './lib/security-checks.js';
import { installFatalHandlers } from './lib/fatal-handlers.js';
import { runStartupSteps, startupStatus } from './lib/startup-steps.js';
import { emitEvent } from './lib/event-emitter.js';
import { tryCatch } from 'stderr-lib';

const PORT = config.PORT;

const server = app.listen(PORT, () => {
  logger.info(
    { nodeVersion: process.version, environment: config.NODE_ENV, port: PORT },
    'GalvaniFlow server started'
  );
});

// Attach Socket.IO to HTTP server
initializeSocketIO(server);

// Initialize log capture stream for server logs feature
setLogCaptureStream(LogStreamService.createWritableStream());

// Start the job queue (then the pruner scheduler) and redeploy channels. Each
// step runs on its own: a failed one is logged, emitted as an event and shown
// by the health endpoints, and does not skip the others (#259).
void runStartupSteps({
  logger,
  emitEvent,
  status: startupStatus,
  startQueue: () => tryCatch(async () => { await startQueue(); }),
  startPrunerScheduler: () => PrunerSchedulerService.start(),
  redeployChannels: () => DeploymentService.autoDeployChannels(),
});
void warnIfDefaultAdminPassword();

// Graceful shutdown — ordered cleanup with engine disposal before DB pool close
const shutdown = createShutdownHandler({
  logger,
  stopAccepting: () => new Promise<void>((resolve, reject) => {
    server.close((err) => {
      // Socket.IO shutdown runs first and closes the shared HTTP server, so by
      // the time we get here the server may already be closed — that's success.
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(err);
        return;
      }
      resolve();
    });
  }),
  stopEngine: async () => {
    const { getEngine } = await import('./engine.js');
    const engine = getEngine();
    // Undeploy all channels (flushes global maps, runs undeploy scripts)
    await undeployAll(engine, logger);
    await engine.dispose();
  },
  stopSocketIO: shutdownSocketIO,
  stopPrunerScheduler: async () => { await PrunerSchedulerService.stop(); },
  stopQueue,
  stopDataSourcePools: () => dataSourcePoolManager.shutdown(),
  closePool: () => pool.end(),
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
installFatalHandlers({ proc: process, logger, shutdown });
