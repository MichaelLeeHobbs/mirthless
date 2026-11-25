import type { Logger } from 'pino';
import { settleWithin } from '@galvanigraph/core-util';

export interface ShutdownDeps {
  readonly logger: Logger;
  readonly stopAccepting: () => Promise<void>;
  readonly stopEngine: () => Promise<void>;
  readonly stopSocketIO: () => Promise<void>;
  readonly stopPrunerScheduler: () => Promise<void>;
  readonly stopQueue: () => Promise<void>;
  readonly stopDataSourcePools: () => Promise<void>;
  readonly closePool: () => Promise<void>;
}

const DRAIN_TIMEOUT_MS = 30_000;

/** Part of the drain timeout: the rest is for undeploying the channels. */
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

export interface QueueingEngine {
  getAll(): ReadonlyMap<string, { readonly queueConsumers: ReadonlyArray<{ stop(): Promise<void>; halt(): Promise<void> }> }>;
}

/**
 * An undeploy waits for the queued send in flight, which may take minutes, and the channels are undeployed
 * one after another. A send that a halt ends is back on its queue.
 */
export async function endQueues(engine: QueueingEngine, log: { warn(obj: object, msg: string): void }): Promise<void> {
  const consumers = [...engine.getAll().values()].flatMap((c) => c.queueConsumers);
  if (await settleWithin(Promise.all(consumers.map((c) => c.stop())), QUEUES_END_MS)) return;
  log.warn({ phase: 'shutdown', waitedMs: QUEUES_END_MS }, 'A queued send has not ended; halting the queues, which puts it back');
  // Not waited for: a connector that cannot cancel its send would hold up every channel's undeploy.
  for (const c of consumers) void c.halt();
}

export interface UndeployableEngine {
  getAll(): ReadonlyMap<string, unknown>;
  undeploy(channelId: string): Promise<void>;
}

/**
 * One channel failing to undeploy must not leave the others running or skip the
 * steps that follow (the global map flush).
 */
export async function undeployAll(
  engine: UndeployableEngine,
  log: { error(obj: object, msg: string): void },
): Promise<void> {
  for (const id of [...engine.getAll().keys()]) {
    try {
      await engine.undeploy(id);
    } catch (err) {
      log.error(
        { channelId: id, errMsg: err instanceof Error ? err.message : String(err) },
        'Channel failed to undeploy during shutdown',
      );
    }
  }
}
