// ===========================================
// Startup Steps
// ===========================================
// Runs the server's startup steps so that one failure doesn't skip the
// others (#259), and records each failed step for the health endpoints.
// Channel redeploy does not use the job queue (destination queues are
// tables the engine polls), so it runs alongside the queue. Only the pruner
// scheduler needs the queue, so it runs after it and fails when it fails.

import type { Logger } from 'pino';
import { tryCatch, type Result } from 'stderr-lib';
import type { CreateEventInput } from '@galvaniflow/core-models';

export const STARTUP_STEP = {
  QUEUE: 'queue',
  PRUNER_SCHEDULER: 'pruner-scheduler',
  CHANNEL_REDEPLOY: 'channel-redeploy',
} as const;
export type StartupStepName = typeof STARTUP_STEP[keyof typeof STARTUP_STEP];

/** A startup step that failed, as the health endpoints report it. */
export interface StartupFailure {
  readonly step: StartupStepName;
  readonly errMsg: string;
  readonly failedAt: string;
}

/** The failed startup steps of this process. Empty while every step that ran succeeded. */
export class StartupStatus {
  private readonly failures = new Map<StartupStepName, StartupFailure>();

  /** Record a failed step; a later failure of the same step replaces it. */
  recordFailure(failure: StartupFailure): void {
    this.failures.set(failure.step, failure);
  }

  /** Forget a step's failure: it finished after it was reported failed. */
  clearFailure(step: StartupStepName): void {
    this.failures.delete(step);
  }

  /** The failed steps, in the order they failed. */
  failed(): readonly StartupFailure[] {
    return [...this.failures.values()];
  }
}

/** The status the server's health endpoints read. */
export const startupStatus = new StartupStatus();

/** Dependencies of the startup run: the steps and where a failure is reported. */
export interface StartupDeps {
  readonly logger: Logger;
  readonly emitEvent: (input: CreateEventInput) => void;
  readonly status: StartupStatus;
  readonly startQueue: () => Promise<Result<void>>;
  readonly startPrunerScheduler: () => Promise<Result<void>>;
  readonly redeployChannels: () => Promise<Result<void>>;
}

/**
 * How long a step may run before it is reported failed. Generous: redeploying
 * many channels takes a while. The step keeps running; if it finishes later,
 * its failure is cleared (or replaced by its real error).
 */
export const STARTUP_STEP_TIMEOUT_MS = 60_000;

/**
 * Run every startup step. The queue and channel redeploy run side by side;
 * the pruner scheduler runs once the queue has started, and is reported as
 * failed when the queue failed or has not started in time. A step that fails,
 * throws or overruns STARTUP_STEP_TIMEOUT_MS is logged at ERROR, emitted as a
 * SERVER_STARTUP_STEP_FAILED event and recorded in `deps.status`. Resolves
 * when every step has settled; never rejects.
 */
export async function runStartupSteps(deps: StartupDeps): Promise<void> {
  const queueThenPruner = async (): Promise<void> => {
    const queueOk = await runStep(deps, STARTUP_STEP.QUEUE, deps.startQueue, () => {
      reportFailure(deps, STARTUP_STEP.PRUNER_SCHEDULER, new Error('Not started: the job queue has not started'));
    });
    if (queueOk) {
      await runStep(deps, STARTUP_STEP.PRUNER_SCHEDULER, deps.startPrunerScheduler);
      return;
    }
    reportFailure(deps, STARTUP_STEP.PRUNER_SCHEDULER, new Error('Not started: the job queue did not start'));
  };
  await Promise.all([
    queueThenPruner(),
    runStep(deps, STARTUP_STEP.CHANNEL_REDEPLOY, deps.redeployChannels),
  ]);
}

/**
 * Run one step; true when it succeeded. A thrown error counts as a failure.
 * Past the timeout the step is reported failed (and `onTimeout` runs) while
 * it keeps running; a late success clears the failure and is logged at WARN.
 */
async function runStep(
  deps: StartupDeps,
  step: StartupStepName,
  run: () => Promise<Result<void>>,
  onTimeout?: () => void,
): Promise<boolean> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reportFailure(deps, step, new Error(`Did not finish within ${String(STARTUP_STEP_TIMEOUT_MS / 1000)} s; still running`));
    onTimeout?.();
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
