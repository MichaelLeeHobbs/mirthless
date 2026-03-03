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

// Graceful shutdown
function shutdown(signal: string): void {
  logger.info({ signal }, 'Received signal, shutting down gracefully');
  server.close(async () => {
    await shutdownSocketIO();
    await stopQueue();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
