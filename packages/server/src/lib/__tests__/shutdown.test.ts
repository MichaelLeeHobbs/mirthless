import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShutdownHandler, endQueues, type ShutdownDeps } from '../shutdown.js';

const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

function createMockLogger(): ShutdownDeps['logger'] {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'info',
  } as unknown as ShutdownDeps['logger'];
}

function createMockDeps(overrides?: Partial<ShutdownDeps>): ShutdownDeps {
  return {
    logger: createMockLogger(),
    stopAccepting: vi.fn().mockResolvedValue(undefined),
    stopEngine: vi.fn().mockResolvedValue(undefined),
    stopSocketIO: vi.fn().mockResolvedValue(undefined),
    stopPrunerScheduler: vi.fn().mockResolvedValue(undefined),
    stopQueue: vi.fn().mockResolvedValue(undefined),
    stopDataSourcePools: vi.fn().mockResolvedValue(undefined),
    closePool: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createShutdownHandler', () => {
  let listeners: readonly NodeJS.BeforeExitListener[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    mockExit.mockClear();
    listeners = process.listeners('beforeExit');
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const added of process.listeners('beforeExit').filter((l) => !listeners.includes(l))) process.removeListener('beforeExit', added);
  });

  it('calls cleanup steps in correct order', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps({
      stopAccepting: vi.fn().mockImplementation(async () => { callOrder.push('stopAccepting'); }),
      stopEngine: vi.fn().mockImplementation(async () => { callOrder.push('stopEngine'); }),
      stopSocketIO: vi.fn().mockImplementation(async () => { callOrder.push('stopSocketIO'); }),
      stopPrunerScheduler: vi.fn().mockImplementation(async () => { callOrder.push('stopPrunerScheduler'); }),
      stopQueue: vi.fn().mockImplementation(async () => { callOrder.push('stopQueue'); }),
      stopDataSourcePools: vi.fn().mockImplementation(async () => { callOrder.push('stopDataSourcePools'); }),
      closePool: vi.fn().mockImplementation(async () => { callOrder.push('closePool'); }),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');

    // Runs the async IIFE.
    await vi.advanceTimersByTimeAsync(0);

    expect(callOrder).toEqual([
      'stopSocketIO',
      'stopAccepting',
      'stopEngine',
      'stopPrunerScheduler',
      'stopQueue',
      'stopDataSourcePools',
      'closePool',
    ]);
  });

  it('exits with code 0 on successful shutdown', async () => {
    const deps = createMockDeps();
    const handler = createShutdownHandler(deps);

    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('logs each step with structured messages', async () => {
    const deps = createMockDeps();
    const handler = createShutdownHandler(deps);

    handler('SIGINT');
    await vi.advanceTimersByTimeAsync(0);

    const logged = vi.mocked(deps.logger.info).mock.calls;
    for (const line of [
      [{ signal: 'SIGINT' }, 'Received signal, starting graceful shutdown'],
      [{ phase: 'shutdown', step: 'socketio' }, 'Shutting down Socket.IO'],
      [{ phase: 'shutdown', step: 'http' }, 'Closing HTTP server'],
      [{ phase: 'shutdown', step: 'engine' }, 'Stopping engine'],
      [{ phase: 'shutdown', step: 'pruner' }, 'Stopping pruner scheduler'],
      [{ phase: 'shutdown', step: 'queue' }, 'Stopping job queue'],
      [{ phase: 'shutdown', step: 'datasource-pools' }, 'Closing data source pools'],
      [{ phase: 'shutdown', step: 'database' }, 'Closing database pool'],
      [{ phase: 'shutdown' }, 'Graceful shutdown complete'],
    ]) expect(logged).toContainEqual(line);
  });

  it('exits with the given code after a clean shutdown that followed a fatal error', async () => {
    const handler = createShutdownHandler(createMockDeps());

    handler('uncaughtException', 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockExit).not.toHaveBeenCalledWith(0);
  });

  it('logs signal name on shutdown start', async () => {
    const deps = createMockDeps();
    const handler = createShutdownHandler(deps);

    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.logger.info).toHaveBeenCalledWith(
      { signal: 'SIGTERM' },
      'Received signal, starting graceful shutdown',
    );
  });

  it('ignores duplicate shutdown signal', async () => {
    const deps = createMockDeps();
    const handler = createShutdownHandler(deps);

    handler('SIGTERM');
    handler('SIGINT');
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { signal: 'SIGINT' },
      'Duplicate shutdown signal ignored',
    );
    expect(deps.stopAccepting).toHaveBeenCalledTimes(1);
  });

  it('exits with code 1 when force timeout fires', async () => {
    const neverResolves = new Promise<void>(() => {});
    const deps = createMockDeps({
      stopAccepting: vi.fn().mockReturnValue(neverResolves),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');

    // Advance past the 30s timeout
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { phase: 'shutdown', errMsg: 'Timeout exceeded' },
      'Graceful shutdown timed out, forcing exit',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when a cleanup step throws', async () => {
    const deps = createMockDeps({
      stopEngine: vi.fn().mockRejectedValue(new Error('engine boom')),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { errMsg: 'engine boom', stack: expect.any(String), phase: 'shutdown' },
      'Error during shutdown',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('stringifies non-Error exceptions during shutdown', async () => {
    const deps = createMockDeps({
      stopQueue: vi.fn().mockRejectedValue('string error'),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { errMsg: 'string error', stack: undefined, phase: 'shutdown' },
      'Error during shutdown',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not call subsequent steps after one fails', async () => {
    const deps = createMockDeps({
      stopEngine: vi.fn().mockRejectedValue(new Error('engine fail')),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(deps.stopSocketIO).toHaveBeenCalledTimes(1);
    expect(deps.stopAccepting).toHaveBeenCalledTimes(1);
    expect(deps.stopPrunerScheduler).not.toHaveBeenCalled();
    expect(deps.stopQueue).not.toHaveBeenCalled();
    expect(deps.stopDataSourcePools).not.toHaveBeenCalled();
    expect(deps.closePool).not.toHaveBeenCalled();
  });

  it('closePool is the last async step called', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps({
      stopAccepting: vi.fn().mockImplementation(async () => { callOrder.push('stopAccepting'); }),
      stopEngine: vi.fn().mockImplementation(async () => { callOrder.push('stopEngine'); }),
      stopSocketIO: vi.fn().mockImplementation(async () => { callOrder.push('stopSocketIO'); }),
      stopPrunerScheduler: vi.fn().mockImplementation(async () => { callOrder.push('stopPrunerScheduler'); }),
      stopQueue: vi.fn().mockImplementation(async () => { callOrder.push('stopQueue'); }),
      stopDataSourcePools: vi.fn().mockImplementation(async () => { callOrder.push('stopDataSourcePools'); }),
      closePool: vi.fn().mockImplementation(async () => { callOrder.push('closePool'); }),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(callOrder[callOrder.length - 1]).toBe('closePool');
  });
});

const SERVER_DIR = fileURLToPath(new URL('../../../', import.meta.url));

/** Past the 30 s force timer, so a child it holds open ends with the timer's exit code. */
const CHILD_LIMIT_MS = 60_000;

/** A shutdown whose first step never finishes. `meanwhile` is code run along with it. */
const stuckShutdown = (meanwhile: string): string => `
  import { writeSync } from 'node:fs';
  import { createShutdownHandler } from ${JSON.stringify(new URL('../shutdown.ts', import.meta.url).href)};
  const say = (text) => { writeSync(1, text + '\\n'); };
  const logger = { info: () => {}, error: (_fields, message) => { say(message); } };
  const stopSocketIO = () => { say('stuck'); return new Promise(() => {}); };
  ${meanwhile}
  createShutdownHandler({ logger, stopSocketIO })('SIGTERM');
`;

interface ChildRun { readonly exitCode: unknown; readonly stdout: string; readonly stderr: string }

function runChild(code: string): Promise<ChildRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', code],
      { cwd: SERVER_DIR, timeout: CHILD_LIMIT_MS, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => { resolve({ exitCode: err === null ? 0 : err.code, stdout, stderr }); },
    );
  });
}

describe('in a process of its own', () => {
  it('says so and fails at once when a step can never finish, because nothing is left to finish it', async () => {
    const { exitCode, stdout, stderr } = await runChild(stuckShutdown(''));

    expect({ exitCode, stdout }, stderr).toEqual({ exitCode: 1, stdout: 'stuck\nGraceful shutdown cannot finish, forcing exit\n' });
  }, CHILD_LIMIT_MS + 5_000);

  it('says nothing of it while something is left that could finish the step', async () => {
    const { exitCode, stdout, stderr } = await runChild(stuckShutdown(`setTimeout(() => { say('still here'); process.exit(7); }, 1_000);`));

    expect({ exitCode, stdout }, stderr).toEqual({ exitCode: 7, stdout: 'stuck\nstill here\n' });
  }, CHILD_LIMIT_MS + 5_000);
});

describe('endQueues', () => {
  interface Consumer { readonly stop: ReturnType<typeof vi.fn>; readonly halt: ReturnType<typeof vi.fn> }
  const consumer = (stopped: Promise<void>): Consumer => ({ stop: vi.fn().mockReturnValue(stopped), halt: vi.fn().mockReturnValue(stopped) });
  const engineOf = (...channels: readonly (readonly Consumer[])[]): Parameters<typeof endQueues>[0] =>
    ({ getAll: () => new Map(channels.map((queueConsumers, i) => [String(i), { queueConsumers }])) });
  const never = new Promise<void>(() => undefined);
  const warn = vi.fn();

  afterEach(() => { vi.useRealTimers(); });

  it('stops every channel\'s queues at once, and halts none when their sends end', async () => {
    const all = [consumer(Promise.resolve()), consumer(Promise.resolve()), consumer(Promise.resolve())];

    await endQueues(engineOf([all[0]!, all[1]!], [], [all[2]!]), { warn });

    for (const c of all) {
      expect(c.stop).toHaveBeenCalledOnce();
      expect(c.halt).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('halts them after 20 seconds and goes on, also when a send cannot be cancelled', async () => {
    vi.useFakeTimers();
    const stuck = consumer(never);

    const ended = endQueues(engineOf([stuck], [consumer(Promise.resolve())]), { warn });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(stuck.halt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await ended;

    expect(stuck.halt).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('undeployAll', () => {
  it('undeploys the remaining channels when one fails, and logs the failure', async () => {
    const { undeployAll } = await import('../shutdown.js');
    const undeployed: string[] = [];
    const engine = {
      getAll: () => new Map([['a', {}], ['b', {}], ['c', {}]]),
      undeploy: async (id: string): Promise<void> => {
        if (id === 'b') throw new Error('undeploy script failed');
        undeployed.push(id);
      },
    };
    const error = vi.fn();

    await undeployAll(engine, { error });

    expect(undeployed).toEqual(['a', 'c']);
    expect(error).toHaveBeenCalledWith(
      { channelId: 'b', errMsg: 'undeploy script failed' },
      'Channel failed to undeploy during shutdown',
    );
  });
});
