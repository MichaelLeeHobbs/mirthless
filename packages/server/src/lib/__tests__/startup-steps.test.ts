// ===========================================
// Startup Steps Tests
// ===========================================
// One failed startup step must not skip the others, and each failure is
// logged, emitted as an event and recorded for the health endpoints (#259).

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import type { Result } from 'stderr-lib';
import { runStartupSteps, StartupStatus, STARTUP_STEP, type StartupDeps } from '../startup-steps.js';

const OK: Result<void> = { ok: true, value: undefined, error: null };

function failed(message: string): Result<void> {
  return { ok: false, value: null, error: new Error(message) };
}

interface Harness {
  readonly deps: StartupDeps;
  readonly status: StartupStatus;
  readonly logError: ReturnType<typeof vi.fn>;
  readonly emitEvent: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<Pick<StartupDeps, 'startQueue' | 'startPrunerScheduler' | 'redeployChannels'>> = {}): Harness {
  const status = new StartupStatus();
  const logError = vi.fn();
  const emitEvent = vi.fn();
  const logger = { error: logError, info: vi.fn(), warn: vi.fn() } as unknown as Logger;
  const deps: StartupDeps = {
    logger, emitEvent, status,
    startQueue: vi.fn(async () => OK),
    startPrunerScheduler: vi.fn(async () => OK),
    redeployChannels: vi.fn(async () => OK),
    ...overrides,
  };
  return { deps, status, logError, emitEvent };
}

describe('runStartupSteps', () => {
  it('runs every step and records no failure when all succeed', async () => {
    const h = harness();

    await runStartupSteps(h.deps);

    expect(h.deps.startQueue).toHaveBeenCalledOnce();
    expect(h.deps.startPrunerScheduler).toHaveBeenCalledOnce();
    expect(h.deps.redeployChannels).toHaveBeenCalledOnce();
    expect(h.status.failed()).toEqual([]);
    expect(h.emitEvent).not.toHaveBeenCalled();
    expect(h.logError).not.toHaveBeenCalled();
  });

  it('still redeploys channels when the queue fails, and reports the queue and the pruner as failed', async () => {
    const h = harness({ startQueue: vi.fn(async () => failed('permission denied for database')) });

    await runStartupSteps(h.deps);

    expect(h.deps.redeployChannels).toHaveBeenCalledOnce();
    expect(h.deps.startPrunerScheduler).not.toHaveBeenCalled();
    expect(h.status.failed().map((f) => f.step)).toEqual([STARTUP_STEP.QUEUE, STARTUP_STEP.PRUNER_SCHEDULER]);
    expect(h.status.failed()[0]).toMatchObject({ errMsg: 'permission denied for database' });
    expect(h.status.failed()[1]?.errMsg).toContain('job queue did not start');
  });

  it('treats a step that throws like one that returns a failure', async () => {
    const h = harness({ startQueue: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) });

    await runStartupSteps(h.deps);

    expect(h.deps.redeployChannels).toHaveBeenCalledOnce();
    expect(h.status.failed()[0]).toMatchObject({ step: STARTUP_STEP.QUEUE, errMsg: 'connect ECONNREFUSED' });
  });

  it('keeps the queue and pruner running when channel redeploy fails', async () => {
    const h = harness({ redeployChannels: vi.fn(async () => failed('1 of 3 channels failed to redeploy: ADT')) });

    await runStartupSteps(h.deps);

    expect(h.deps.startQueue).toHaveBeenCalledOnce();
    expect(h.deps.startPrunerScheduler).toHaveBeenCalledOnce();
    expect(h.status.failed()).toEqual([
      expect.objectContaining({ step: STARTUP_STEP.CHANNEL_REDEPLOY, errMsg: '1 of 3 channels failed to redeploy: ADT' }),
    ]);
  });

  it('reports a failed pruner scheduler without touching the other steps', async () => {
    const h = harness({ startPrunerScheduler: vi.fn(async () => failed('bad cron')) });

    await runStartupSteps(h.deps);

    expect(h.deps.redeployChannels).toHaveBeenCalledOnce();
    expect(h.status.failed().map((f) => f.step)).toEqual([STARTUP_STEP.PRUNER_SCHEDULER]);
  });

  it('logs each failure at ERROR and emits an ERROR event naming the step', async () => {
    const h = harness({ redeployChannels: vi.fn(async () => failed('db down')) });

    await runStartupSteps(h.deps);

    expect(h.logError).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'startup', step: STARTUP_STEP.CHANNEL_REDEPLOY, errMsg: 'db down' }),
      'Startup step failed',
    );
    expect(h.emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'ERROR',
      name: 'SERVER_STARTUP_STEP_FAILED',
      outcome: 'FAILURE',
      attributes: { step: STARTUP_STEP.CHANNEL_REDEPLOY, error: 'db down' },
    }));
  });

  it('does not wait for the queue before redeploying channels', async () => {
    let releaseQueue: () => void = () => undefined;
    const queueStarted = new Promise<Result<void>>((resolve) => { releaseQueue = (): void => resolve(OK); });
    const h = harness({ startQueue: vi.fn(() => queueStarted) });

    const run = runStartupSteps(h.deps);
    await vi.waitFor(() => expect(h.deps.redeployChannels).toHaveBeenCalledOnce());
    releaseQueue();
    await run;

    expect(h.deps.startPrunerScheduler).toHaveBeenCalledOnce();
  });
});
