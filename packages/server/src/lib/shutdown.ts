// ===========================================
// Graceful Shutdown Handler
// ===========================================
// Ordered cleanup of server resources on SIGTERM/SIGINT.
// Ensures engine channels are undeployed and global map
// values are flushed before the DB pool closes.

import type { Logger } from 'pino';

/** Dependencies for the shutdown handler. */
export interface ShutdownDeps {
  readonly logger: Logger;
  readonly stopAccepting: () => Promise<void>;
  readonly stopEngine: () => Promise<void>;
  readonly stopSocketIO: () => Promise<void>;
  readonly stopPrunerScheduler: () => Promise<void>;
  readonly stopQueue: () => Promise<void>;
  readonly closePool: () => Promise<void>;
}

const DRAIN_TIMEOUT_MS = 30_000;

/**
 * Creates a graceful shutdown handler with ordered cleanup.
 * Each step is logged, and a force-exit timer ensures the
 * process terminates even if a step hangs.
 *
 * Shutdown order:
 * 1. Stop accepting new HTTP connections
 * 2. Stop engine (undeploy channels, flush global maps)
 * 3. Shutdown Socket.IO
 * 4. Stop pruner scheduler
 * 5. Stop job queue (pgboss)
 * 6. Close DB pool (last -- engine/queue may need DB)
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  let shutting = false;

  return (signal: string): void => {
    if (shutting) {
      deps.logger.warn({ signal }, 'Duplicate shutdown signal ignored');
      return;
    }
    shutting = true;

    deps.logger.info({ signal }, 'Received signal, starting graceful shutdown');

    const forceTimer = setTimeout(() => {
      deps.logger.error({ phase: 'shutdown', errMsg: 'Timeout exceeded' }, 'Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    forceTimer.unref();

    void (async (): Promise<void> => {
      try {
        deps.logger.info({ phase: 'shutdown', step: 'http' }, 'Closing HTTP server');
        await deps.stopAccepting();

        deps.logger.info({ phase: 'shutdown', step: 'engine' }, 'Stopping engine');
        await deps.stopEngine();

        deps.logger.info({ phase: 'shutdown', step: 'socketio' }, 'Shutting down Socket.IO');
        await deps.stopSocketIO();

        deps.logger.info({ phase: 'shutdown', step: 'pruner' }, 'Stopping pruner scheduler');
        await deps.stopPrunerScheduler();

        deps.logger.info({ phase: 'shutdown', step: 'queue' }, 'Stopping job queue');
        await deps.stopQueue();

        deps.logger.info({ phase: 'shutdown', step: 'database' }, 'Closing database pool');
        await deps.closePool();

        deps.logger.info({ phase: 'shutdown' }, 'Graceful shutdown complete');
        process.exit(0);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        deps.logger.error({ errMsg, stack, phase: 'shutdown' }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  };
}
