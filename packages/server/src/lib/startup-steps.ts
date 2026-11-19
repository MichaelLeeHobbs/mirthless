// One failed startup step does not skip the others (#259). Channel redeploy
// does not use the job queue (destination queues are tables the engine polls),
// so it runs alongside it; only the pruner scheduler needs the queue.

import type { Logger } from 'pino';
import { tryCatch, type Result } from 'stderr-lib';
import type { CreateEventInput } from '@galvanigraph/core-models';

export const STARTUP_STEP = {
  QUEUE: 'queue',
  PRUNER_SCHEDULER: 'pruner-scheduler',
  CHANNEL_REDEPLOY: 'channel-redeploy',
  /** Keeps audit_log's month partitions ahead (D-312); server.ts reruns it daily. */
  AUDIT_PARTITIONS: 'audit-partitions',
} as const;
export type StartupStepName = typeof STARTUP_STEP[keyof typeof STARTUP_STEP];

export interface StartupFailure {
  readonly step: StartupStepName;
  readonly errMsg: string;
  readonly failedAt: string;
}

export class StartupStatus {
  private readonly failures = new Map<StartupStepName, StartupFailure>();

  recordFailure(failure: StartupFailure): void {
    this.failures.set(failure.step, failure);
  }

  clearFailure(step: StartupStepName): void {
    this.failures.delete(step);
  }

  failed(): readonly StartupFailure[] {
    return [...this.failures.values()];
  }
}

/** The status the server's health endpoints read. */
export const startupStatus = new StartupStatus();

export interface StartupDeps {
  readonly logger: Logger;
  readonly emitEvent: (input: CreateEventInput) => void;
  readonly status: StartupStatus;
  readonly startQueue: () => Promise<Result<void>>;
  readonly startPrunerScheduler: () => Promise<Result<void>>;
  readonly redeployChannels: () => Promise<Result<void>>;
  readonly ensureAuditPartitions: () => Promise<Result<void>>;
}

/**
 * The queue or the pruner scheduler is then reported failed but keeps running.
 * Channel redeploy has no timeout: a large install takes as long as it takes,
 * and it reports each channel that fails on its own.
 */
export const STARTUP_STEP_TIMEOUT_MS = 60_000;

/** Resolves when every step has settled; never rejects. */
export async function runStartupSteps(deps: StartupDeps): Promise<void> {
  const queueThenPruner = async (): Promise<void> => {
    const queueOk = await runStep(deps, STARTUP_STEP.QUEUE, deps.startQueue, {
      onTimeout: () => { reportFailure(deps, STARTUP_STEP.PRUNER_SCHEDULER, new Error('Not started: the job queue has not started')); },
    });
    if (queueOk) {
      await runStep(deps, STARTUP_STEP.PRUNER_SCHEDULER, deps.startPrunerScheduler, {});
      return;
    }
    reportFailure(deps, STARTUP_STEP.PRUNER_SCHEDULER, new Error('Not started: the job queue did not start'));
  };
  await Promise.all([
    queueThenPruner(),
    runStep(deps, STARTUP_STEP.CHANNEL_REDEPLOY, deps.redeployChannels),
    runStep(deps, STARTUP_STEP.AUDIT_PARTITIONS, deps.ensureAuditPartitions),
  ]);
}

/** True when it succeeded; a success clears the step's earlier failure. */
export function rerunStep(deps: StartupDeps, step: StartupStepName, run: () => Promise<Result<void>>): Promise<boolean> {
  return runStep(deps, step, run);
}

async function runStep(
  deps: StartupDeps,
  step: StartupStepName,
  run: () => Promise<Result<void>>,
  timeout?: { readonly onTimeout?: () => void },
): Promise<boolean> {
  let timedOut = false;
  const timer = timeout === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    reportFailure(deps, step, new Error(`Did not finish within ${String(STARTUP_STEP_TIMEOUT_MS / 1000)} s; still running`));
    timeout.onTimeout?.();
  }, STARTUP_STEP_TIMEOUT_MS);
  const outcome = await tryCatch(run);
  clearTimeout(timer);
  const result = outcome.ok ? outcome.value : outcome;
  if (!result.ok) {
    reportFailure(deps, step, result.error);
    return false;
  }
  // A success clears a failure reported while it waited: its own timeout, or
  // the pruner's "queue has not started" when the queue finished late.
  deps.status.clearFailure(step);
  if (timedOut) {
    deps.logger.warn({ phase: 'startup', step }, 'Startup step finished after its timeout');
  }
  return true;
}

function reportFailure(deps: StartupDeps, step: StartupStepName, error: Error): void {
  deps.logger.error({ phase: 'startup', step, errMsg: error.message, stack: error.stack }, 'Startup step failed');
  deps.status.recordFailure({ step, errMsg: error.message, failedAt: new Date().toISOString() });
  deps.emitEvent({
    level: 'ERROR', name: 'SERVER_STARTUP_STEP_FAILED', outcome: 'FAILURE', userId: null, channelId: null,
    serverId: null, ipAddress: null, attributes: { step, error: error.message },
  });
}
