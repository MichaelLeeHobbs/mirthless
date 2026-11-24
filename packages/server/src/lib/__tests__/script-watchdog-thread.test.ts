// How the watchdog's thread is started and kept, with node's Worker faked: script-watchdog.test.ts
// runs the real one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { readScriptWatch, scriptWatchBuffer, watchScript } from '@galvanigraph/engine/script-watch';

interface FakeOptions { readonly workerData: { readonly limits: unknown; readonly db: unknown; readonly shared: unknown }; readonly env: Record<string, string> }
interface FakeWorker extends EventEmitter { readonly options: FakeOptions; readonly unref: ReturnType<typeof vi.fn> }

const started: FakeWorker[] = [];
let noThreads = false;
vi.mock('node:worker_threads', async (original) => ({
  ...await original<typeof import('node:worker_threads')>(),
  Worker: class extends EventEmitter {
    readonly unref = vi.fn();
    constructor(_url: URL, readonly options: FakeOptions) {
      super();
      if (noThreads) throw new Error('ERR_WORKER_INIT_FAILED');
      started.push(this as unknown as FakeWorker);
    }
  },
}));
let inspectorUrl: string | undefined;
vi.mock('node:inspector', () => ({ url: (): string | undefined => inspectorUrl }));

const { startScriptWatchdog, THREAD_RESTART_MS, WATCHDOG_LIMITS } = await import('../script-watchdog.js');

const log = { warn: vi.fn(), error: vi.fn() };
const savedEnv = { ...process.env };

function start(deps: Partial<Parameters<typeof startScriptWatchdog>[0]> = {}): FakeWorker {
  startScriptWatchdog({ logger: log as unknown as Logger, db: {}, pid: 7, platform: 'linux', ...deps });
  const worker = started.at(-1);
  if (!worker) throw new Error('no thread was started');
  return worker;
}

const sequence = (): number => readScriptWatch(scriptWatchBuffer()).sequence;

beforeEach(() => {
  vi.useFakeTimers();
  started.length = 0;
  noThreads = false;
  inspectorUrl = undefined;
  log.warn.mockClear();
  log.error.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  process.env = { ...savedEnv };
});

describe('startScriptWatchdog', () => {
  it('waits a minute past the limit: a script that overruns it and then ends has been seen to take 42 s', () => {
    expect(start().options.workerData.limits).toEqual({ graceMs: 60_000, tickMs: 1_000 });
    expect(WATCHDOG_LIMITS.graceMs).toBe(60_000);
  });

  it('does not keep the server alive', () => {
    expect(start().unref).toHaveBeenCalled();
  });

  it('gives the thread the database connection and the memory the sandbox writes', () => {
    const { workerData } = start({ db: { connectionString: 'postgresql://h/db', ssl: { rejectUnauthorized: true, ca: 'PEM' }, max: 20 } }).options;
    expect(workerData.db).toEqual({ connectionString: 'postgresql://h/db', ssl: { rejectUnauthorized: true, ca: 'PEM' } });
    expect(workerData.shared).toBe(scriptWatchBuffer());
  });

  it('gives the thread what pg reads from the environment, and no other secret', () => {
    process.env['PGPASSWORD'] = 'pw';
    process.env['HOME'] = '/home/gg';
    process.env['USER'] = 'gg';
    process.env['JWT_SECRET'] = 'secret';
    process.env['DATABASE_URL'] = 'postgresql://h/db';
    const { env } = start().options;
    expect(env).toMatchObject({ PGPASSWORD: 'pw', HOME: '/home/gg', USER: 'gg' });
    expect(env).not.toHaveProperty('JWT_SECRET');
    expect(env).not.toHaveProperty('DATABASE_URL');
  });

  it('shows a sign of life at once and at every tick, so a turning event loop is never a stuck one', () => {
    const before = sequence();
    start();
    const first = sequence();
    vi.advanceTimersByTime(3 * WATCHDOG_LIMITS.tickMs);
    expect(first).toBe(before + 1);
    expect(sequence()).toBe(first + 3);
  });

  it('logs when the thread stops, and starts another', () => {
    start().emit('exit', 1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('watchdog does not run'));
    expect(started).toHaveLength(1);
    vi.advanceTimersByTime(THREAD_RESTART_MS);
    expect(started).toHaveLength(2);
    started[1]?.emit('exit', 1);
    vi.advanceTimersByTime(THREAD_RESTART_MS);
    expect(started).toHaveLength(3);
  });

  it('keeps the server up when no thread can be had, and tries again', () => {
    noThreads = true;
    expect(() => { startScriptWatchdog({ logger: log as unknown as Logger, db: {}, pid: 7, platform: 'linux' }); }).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'ERR_WORKER_INIT_FAILED' }), expect.any(String));
    vi.advanceTimersByTime(THREAD_RESTART_MS);
    noThreads = false;
    expect(started).toHaveLength(0);
    vi.advanceTimersByTime(THREAD_RESTART_MS);
    expect(started).toHaveLength(1);
  });

  it('logs why the thread failed', () => {
    start().emit('error', new Error('no such module'));
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ errMsg: 'no such module' }), expect.any(String));
  });

  it('is off while a debugger is open, however late it opens, and says so once each time', () => {
    const limit = (): number => watchScript(500, 'c', () => readScriptWatch(scriptWatchBuffer()).limitMs);
    start();
    expect(limit()).toBe(500);
    inspectorUrl = 'ws://127.0.0.1:9229/x';
    vi.advanceTimersByTime(5 * WATCHDOG_LIMITS.tickMs);
    expect(limit()).toBe(0);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('debugger'));
    inspectorUrl = undefined;
    vi.advanceTimersByTime(WATCHDOG_LIMITS.tickMs);
    expect(limit()).toBe(500);
    inspectorUrl = 'ws://127.0.0.1:9229/x';
    vi.advanceTimersByTime(WATCHDOG_LIMITS.tickMs);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['warns that PID 1 cannot end itself', 1, 'linux' as const, 1],
    ['says nothing of any other process', 7, 'linux' as const, 0],
    ['says nothing on Windows, which has no PID 1', 1, 'win32' as const, 0],
  ])('%s', (_name, pid, platform, warnings) => {
    start({ pid, platform });
    expect(log.warn).toHaveBeenCalledTimes(warnings);
  });
});
