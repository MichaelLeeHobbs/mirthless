// A pg-boss that fails to start is stopped, and one whose start hangs is
// stopped at shutdown, so neither leaves its pool and timers behind (#259).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeBoss {
  readonly on: ReturnType<typeof vi.fn>;
  readonly start: ReturnType<typeof vi.fn>;
  readonly stop: ReturnType<typeof vi.fn>;
}

interface Behaviour {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const { instances, behaviour, mockWarn } = vi.hoisted(() => ({
  instances: [] as FakeBoss[],
  behaviour: { start: async () => undefined, stop: async () => undefined } as Behaviour,
  mockWarn: vi.fn(),
}));

vi.mock('pg-boss', () => ({
  PgBoss: vi.fn().mockImplementation(function fakeBoss() {
    const instance: FakeBoss = { on: vi.fn(), start: vi.fn(() => behaviour.start()), stop: vi.fn(() => behaviour.stop()) };
    instances.push(instance);
    return instance;
  }),
}));
vi.mock('../../config/index.js', () => ({ config: { DATABASE_URL: 'postgresql://user@localhost:5432/test' } }));
vi.mock('../../db/runtime-role.js', () => ({ PG_BOSS_SCHEMA: 'pgboss' }));
vi.mock('../db.js', () => ({ buildDbSslConfig: () => undefined }));
vi.mock('../logger.js', () => ({ default: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() } }));

const { startQueue, stopQueue, getBoss } = await import('../queue.js');

function latest(): FakeBoss {
  const instance = instances[instances.length - 1];
  if (!instance) throw new Error('no PgBoss was created');
  return instance;
}

describe('startQueue and stopQueue', () => {
  beforeEach(() => {
    instances.length = 0;
    mockWarn.mockClear();
    behaviour.start = async (): Promise<void> => undefined;
    behaviour.stop = async (): Promise<void> => undefined;
  });

  afterEach(async () => {
    await stopQueue();
  });

  it('keeps a started queue and stops it at shutdown', async () => {
    const started = await startQueue();

    expect(getBoss()).toBe(started);
    await stopQueue();
    expect(latest().stop).toHaveBeenCalledOnce();
    expect(getBoss()).toBeNull();
  });

  it('stops a queue whose start failed and rethrows the start error', async () => {
    behaviour.start = async (): Promise<void> => { throw new Error('permission denied for schema pgboss'); };

    await expect(startQueue()).rejects.toThrow('permission denied for schema pgboss');

    expect(latest().stop).toHaveBeenCalledOnce();
    expect(getBoss()).toBeNull();
  });

  it('still rethrows the start error when stopping the failed queue also fails, and logs the stop failure', async () => {
    behaviour.start = async (): Promise<void> => { throw new Error('connect ECONNREFUSED'); };
    behaviour.stop = async (): Promise<void> => { throw new Error('pool already ended'); };

    await expect(startQueue()).rejects.toThrow('connect ECONNREFUSED');

    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'pool already ended' }), 'Could not stop a pgboss that did not start');
  });

  it('stops a start that hangs when the server shuts down, and never makes it the running queue', async () => {
    let finishStart: () => void = () => undefined;
    behaviour.start = (): Promise<void> => new Promise<void>((resolve) => { finishStart = resolve; });
    const run = startQueue();
    await vi.waitFor(() => expect(latest().start).toHaveBeenCalledOnce());

    await stopQueue();
    expect(latest().stop).toHaveBeenCalledOnce();

    finishStart();
    await expect(run).rejects.toThrow('pgboss was stopped while it was starting');
    expect(getBoss()).toBeNull();
  });
});
