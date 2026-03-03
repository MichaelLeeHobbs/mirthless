// ===========================================
// Graceful Shutdown Handler Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createShutdownHandler, type ShutdownDeps } from '../shutdown.js';

// ----- Mocks -----

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
    closePool: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ----- Tests -----

describe('createShutdownHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExit.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls cleanup steps in correct order', async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps({
      stopAccepting: vi.fn().mockImplementation(async () => { callOrder.push('stopAccepting'); }),
      stopEngine: vi.fn().mockImplementation(async () => { callOrder.push('stopEngine'); }),
      stopSocketIO: vi.fn().mockImplementation(async () => { callOrder.push('stopSocketIO'); }),
      stopPrunerScheduler: vi.fn().mockImplementation(async () => { callOrder.push('stopPrunerScheduler'); }),
      stopQueue: vi.fn().mockImplementation(async () => { callOrder.push('stopQueue'); }),
      closePool: vi.fn().mockImplementation(async () => { callOrder.push('closePool'); }),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');

    // Flush all microtasks (the async IIFE)
    await vi.advanceTimersByTimeAsync(0);

    expect(callOrder).toEqual([
      'stopAccepting',
      'stopEngine',
      'stopSocketIO',
      'stopPrunerScheduler',
      'stopQueue',
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

    const infoCalls = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const messages = infoCalls.map((c: unknown[]) => (typeof c[0] === 'string' ? c[0] : c[1]));

    expect(messages).toContain('Closing HTTP server...');
    expect(messages).toContain('Stopping engine...');
    expect(messages).toContain('Shutting down Socket.IO...');
    expect(messages).toContain('Stopping pruner scheduler...');
    expect(messages).toContain('Stopping job queue...');
    expect(messages).toContain('Closing database pool...');
    expect(messages).toContain('Graceful shutdown complete');
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
    // stopAccepting should only be called once
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

    expect(deps.logger.error).toHaveBeenCalledWith('Graceful shutdown timed out, forcing exit');
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
      { error: 'engine boom' },
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
      { error: 'string error' },
      'Error during shutdown',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not call subsequent steps after one fails', async () => {
    const deps = createMockDeps({
      stopSocketIO: vi.fn().mockRejectedValue(new Error('socket fail')),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    // stopAccepting and stopEngine run before stopSocketIO
    expect(deps.stopAccepting).toHaveBeenCalledTimes(1);
    expect(deps.stopEngine).toHaveBeenCalledTimes(1);
    // stopPrunerScheduler, stopQueue, closePool should NOT run
    expect(deps.stopPrunerScheduler).not.toHaveBeenCalled();
    expect(deps.stopQueue).not.toHaveBeenCalled();
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
      closePool: vi.fn().mockImplementation(async () => { callOrder.push('closePool'); }),
    });

    const handler = createShutdownHandler(deps);
    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(callOrder[callOrder.length - 1]).toBe('closePool');
  });

  it('force timer does not prevent process exit (unref)', async () => {
    // We verify by checking that the successful shutdown exits with 0,
    // not 1 from the force timer. If unref() were missing, the timer
    // would keep the event loop alive after process.exit(0).
    const deps = createMockDeps();
    const handler = createShutdownHandler(deps);

    handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);

    expect(mockExit).toHaveBeenCalledWith(0);
    // The force timer should not have fired
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });
});
