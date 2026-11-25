import app from './app.js';
import { config } from './config/index.js';
import logger from './lib/logger.js';
import { buildPoolConfig, pool } from './lib/db.js';
import { startScriptWatchdog } from './lib/script-watchdog.js';
import { startQueue, stopQueue } from './lib/queue.js';
import { initializeSocketIO, shutdownSocketIO } from './lib/socket.js';
import { setLogCaptureStream } from './lib/logger.js';
import { LogStreamService } from './services/log-stream.service.js';
import { PrunerSchedulerService } from './services/pruner-scheduler.service.js';
import { DeploymentService } from './services/deployment.service.js';
import { createShutdownHandler, endQueues, undeployAll } from './lib/shutdown.js';
import { dataSourcePoolManager } from './services/data-source-pool-manager.js';
import { warnIfDefaultAdminPassword } from './lib/security-checks.js';
import { installFatalHandlers } from './lib/fatal-handlers.js';
import { rerunStep, runStartupSteps, startupStatus, STARTUP_STEP } from './lib/startup-steps.js';
import { emitEvent } from './lib/event-emitter.js';
import { PartitionManagerService } from './services/partition-manager.service.js';
import { GrantService } from './services/grant.service.js';
import { tryCatch, type Result } from 'stderr-lib';

const PORT = config.PORT;
const AUDIT_PARTITION_INTERVAL_MS = 24 * 60 * 60 * 1000;

const server = app.listen(PORT, () => {
  logger.info(
    { nodeVersion: process.version, environment: config.NODE_ENV, port: PORT },
    'GalvaniGraph server started'
  );
});

initializeSocketIO(server);

setLogCaptureStream(LogStreamService.createWritableStream());

const ensureAuditPartitions = (): Promise<Result<void>> =>
  tryCatch(async () => {
    const made = await PartitionManagerService.ensureAuditPartitions();
    if (!made.ok) throw made.error;
    // After the partitions, so the row lands in this month's: each month the
    // retention keeps needs a grant baseline for the access replay (D-319).
    if (await GrantService.ensureMonthlyBaseline() === 'deferred') {
      logger.warn('This month\'s grant baseline waited too long on grant changes; the daily run retries it');
    }
  });
const startupDeps = {
  logger,
  emitEvent,
  status: startupStatus,
  startQueue: () => tryCatch(async () => { await startQueue(); }),
  startPrunerScheduler: () => PrunerSchedulerService.start(),
  redeployChannels: () => DeploymentService.autoDeployChannels(),
  ensureAuditPartitions,
};
// Before any channel can run a script.
startScriptWatchdog({ logger, db: buildPoolConfig() });
void runStartupSteps(startupDeps);
// Audit partitions are kept three months ahead (D-312): at start, then daily.
setInterval(() => {
  void rerunStep(startupDeps, STARTUP_STEP.AUDIT_PARTITIONS, ensureAuditPartitions);
}, AUDIT_PARTITION_INTERVAL_MS).unref();
void warnIfDefaultAdminPassword();

const shutdown = createShutdownHandler({
  logger,
  stopAccepting: () => new Promise<void>((resolve, reject) => {
    server.close((err) => {
      // Socket.IO shutdown may already have closed the shared HTTP server: success.
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
    await endQueues(engine, logger);
    // Flushes global maps and runs undeploy scripts before dispose.
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
