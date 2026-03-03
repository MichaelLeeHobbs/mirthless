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
import { createShutdownHandler } from './lib/shutdown.js';

const PORT = config.PORT;

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info({ env: config.NODE_ENV }, 'Environment');
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// Attach Socket.IO to HTTP server
initializeSocketIO(server);

// Initialize log capture stream for server logs feature
setLogCaptureStream(LogStreamService.createWritableStream());

// Start pgboss job queue, then initialize pruner scheduler
startQueue()
  .then(() => PrunerSchedulerService.start())
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Failed to start pgboss or pruner scheduler');
  });

// Graceful shutdown — ordered cleanup with engine disposal before DB pool close
const shutdown = createShutdownHandler({
  logger,
  stopAccepting: () => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  }),
  stopEngine: async () => {
    const { getEngine } = await import('./engine.js');
    const engine = getEngine();
    // Undeploy all channels (flushes global maps, runs undeploy scripts)
    const channelIds = [...engine.getAll().keys()];
    for (const id of channelIds) {
      await engine.undeploy(id);
    }
    await engine.dispose();
  },
  stopSocketIO: shutdownSocketIO,
  stopPrunerScheduler: async () => { await PrunerSchedulerService.stop(); },
  stopQueue,
  closePool: () => pool.end(),
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
