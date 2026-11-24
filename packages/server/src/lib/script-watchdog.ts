// node:vm's time limit does not stop every script, and one it does not stop holds the main thread
// for good. This thread ends the process then, so that the supervisor starts it again (D-340).

import * as inspector from 'node:inspector';
import { Worker } from 'node:worker_threads';
import type pg from 'pg';
import type { Logger } from 'pino';
import { errorInfo } from '@galvanigraph/core-util';
import { beatScriptWatch, scriptWatchBuffer, workerEntry, type StuckLimits } from '@galvanigraph/engine';
import type { WatchdogDb } from './script-hold.js';

/** The grace is for a script that overruns its limit and then ends: the longest seen took 42 s. */
export const WATCHDOG_LIMITS: StuckLimits = { graceMs: 60_000, tickMs: 1_000 };
export const THREAD_RESTART_MS = 10_000;

export interface WatchdogStart {
  readonly shared: SharedArrayBuffer;
  readonly limits: StuckLimits;
  readonly db: WatchdogDb;
}

export interface ScriptWatchdogDeps {
  readonly logger: Pick<Logger, 'warn' | 'error'>;
  readonly db: pg.PoolConfig;
  readonly limits?: StuckLimits;
  readonly pid?: number;
  readonly platform?: NodeJS.Platform;
  readonly debugging?: () => boolean;
}

/** What pg reads: a user name, and where its password file is. The thread gets no more of the environment. */
const DATABASE_ENV: ReadonlySet<string> = new Set(['HOME', 'APPDATA', 'USER', 'USERNAME']);

function databaseEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) =>
    (value !== undefined && (key.startsWith('PG') || DATABASE_ENV.has(key)) ? [[key, value]] : [])));
}

/** Null when no thread can be had: uncaught, that would stop the server. */
function newThread(deps: ScriptWatchdogDeps, start: WatchdogStart): Worker | null {
  const entry = workerEntry(import.meta.url, 'script-watchdog-worker');
  try {
    return new Worker(entry.url, { workerData: start, execArgv: entry.execArgv, env: { ...entry.env, ...databaseEnv() } });
  } catch (err: unknown) {
    deps.logger.error(errorInfo(err), 'The script watchdog could not be started');
    return null;
  }
}

function startThread(deps: ScriptWatchdogDeps, limits: StuckLimits): void {
  const { logger, db } = deps;
  const startAgain = (): void => {
    logger.error(`The script watchdog does not run: a script that hangs the server is not noticed. Starting it again in ${String(THREAD_RESTART_MS / 1_000)} s`);
    setTimeout(() => { startThread(deps, limits); }, THREAD_RESTART_MS).unref();
  };
  const worker = newThread(deps, { shared: scriptWatchBuffer(), limits, db: { connectionString: db.connectionString, ssl: db.ssl } });
  if (worker === null) {
    startAgain();
    return;
  }
  worker.unref();
  worker.on('error', (err: unknown) => { logger.error(errorInfo(err), 'The script watchdog failed'); });
  worker.on('exit', startAgain);
}

export function startScriptWatchdog(deps: ScriptWatchdogDeps): void {
  const { logger, limits = WATCHDOG_LIMITS, pid = process.pid, platform = process.platform } = deps;
  const debugging = deps.debugging ?? ((): boolean => inspector.url() !== undefined);
  if (pid === 1 && platform !== 'win32') {
    logger.warn('The server runs as PID 1, which the script watchdog cannot end: a script that hangs the server would hang it until someone restarts it. Run the container with an init process (docker run --init)');
  }
  let wasDebugging = false;
  const beat = (): void => {
    const now = debugging();
    if (now && !wasDebugging) logger.warn('A debugger is open, so the script watchdog is off: a breakpoint in a script would look like a stuck script');
    wasDebugging = now;
    beatScriptWatch(now);
  };
  beat();
  setInterval(beat, limits.tickMs).unref();
  startThread(deps, limits);
}
