import type { Logger } from 'pino';
import { errorInfo } from '@galvanigraph/core-util';

export interface ShutdownDeps {
  readonly logger: Logger;
  readonly stopAccepting: () => Promise<void>;
  readonly stopEngine: () => Promise<void>;
  /** Ends the queued sends that are still under way. They go back on their queues. */
  readonly haltQueues: () => Promise<void>;
  readonly stopSocketIO: () => Promise<void>;
  readonly stopPrunerScheduler: () => Promise<void>;
  readonly stopQueue: () => Promise<void>;
  readonly stopDataSourcePools: () => Promise<void>;
  readonly closePool: () => Promise<void>;
}

const DRAIN_TIMEOUT_MS = 30_000;

/** From the signal on. What is left of the drain timeout is for what waited for the sends. */
const QUEUES_END_MS = 20_000;

/**
 * Socket.IO goes before the HTTP close: open websockets keep server.close() from
 * resolving. The database pool closes last: the engine and queue need it.
 * `exitCode` is for a clean shutdown: 0 for a signal, non-zero after a fatal error.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string, exitCode?: number) => void {
  let shutting = false;

  return (signal: string, exitCode = 0): void => {
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

    // An undeploy waits for a queued send, and so does closing HTTP when a request to stop a channel does.
    setTimeout(() => {
      deps.logger.warn({ phase: 'shutdown', waitedMs: QUEUES_END_MS }, 'Halting the queued sends that have not ended');
      deps.haltQueues().catch((err: unknown) => { deps.logger.error({ phase: 'shutdown', ...errorInfo(err) }, 'Could not halt the queued sends'); });
    }, QUEUES_END_MS).unref();

    // Nothing is left that could finish the step shutdown is at, so it would end here as if it had been a success.
    process.once('beforeExit', () => {
      deps.logger.error({ phase: 'shutdown', errMsg: 'A step can never finish' }, 'Graceful shutdown cannot finish, forcing exit');
      process.exit(1);
    });

    void (async (): Promise<void> => {
      try {
        deps.logger.info({ phase: 'shutdown', step: 'socketio' }, 'Shutting down Socket.IO');
        await deps.stopSocketIO();

        deps.logger.info({ phase: 'shutdown', step: 'http' }, 'Closing HTTP server');
        await deps.stopAccepting();

        deps.logger.info({ phase: 'shutdown', step: 'engine' }, 'Stopping engine');
        await deps.stopEngine();

        deps.logger.info({ phase: 'shutdown', step: 'pruner' }, 'Stopping pruner scheduler');
        await deps.stopPrunerScheduler();

        deps.logger.info({ phase: 'shutdown', step: 'queue' }, 'Stopping job queue');
        await deps.stopQueue();

        deps.logger.info({ phase: 'shutdown', step: 'datasource-pools' }, 'Closing data source pools');
        await deps.stopDataSourcePools();

        deps.logger.info({ phase: 'shutdown', step: 'database' }, 'Closing database pool');
        await deps.closePool();

        deps.logger.info({ phase: 'shutdown' }, 'Graceful shutdown complete');
        process.exit(exitCode);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        deps.logger.error({ errMsg, stack, phase: 'shutdown' }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  };
}

export interface UndeployableEngine {
  getAll(): ReadonlyMap<string, unknown>;
  undeploy(channelId: string): Promise<void>;
}

/**
 * One channel failing to undeploy must not leave the others running or skip the
 * steps that follow (the global map flush). Nor must one that waits for a send, so
 * they are undeployed at once.
 */
export async function undeployAll(
  engine: UndeployableEngine,
  log: { error(obj: object, msg: string): void },
): Promise<void> {
  await Promise.all([...engine.getAll().keys()].map(async (id) => {
    try {
      await engine.undeploy(id);
    } catch (err) {
      log.error(
        { channelId: id, errMsg: err instanceof Error ? err.message : String(err) },
        'Channel failed to undeploy during shutdown',
      );
    }
  }));
}
