// The main thread is stuck when this matters, so nothing here may wait for it: not the logger, not
// process.stdout (a worker's goes through the main thread), not process.exit (it ends the thread).

import { write } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { workerData } from 'node:worker_threads';
import { readScriptWatch, StuckDetector, type ScriptWatch } from '@galvanigraph/engine/script-watch';
import { holdChannel, holdReason, releaseChannel } from './script-hold.js';
import type { WatchdogStart } from './script-watchdog.js';
import { endStuckServer } from './stuck-script.js';

const FATAL = 60;
const STDOUT = 1;
/** A pipe nobody reads must not keep the process from ending. */
const LOG_TIMEOUT_MS = 1_000;

const { shared, limits, db } = workerData as WatchdogStart;

async function log(fields: Readonly<Record<string, unknown>>, msg: string): Promise<void> {
  const line = `${JSON.stringify({ level: FATAL, time: Date.now(), pid: process.pid, ...fields, msg })}\n`;
  const written = new Promise<void>((resolve) => { write(STDOUT, line, () => { resolve(); }); });
  await Promise.race([written, sleep(LOG_TIMEOUT_MS)]);
}

function end(stuck: ScriptWatch): Promise<void> {
  const reason = holdReason(limits.graceMs, new Date());
  return endStuckServer(stuck, {
    tickMs: limits.tickMs,
    read: () => readScriptWatch(shared),
    hold: (channelId) => holdChannel(db, channelId, reason),
    release: (channelId) => releaseChannel(db, channelId, reason),
    kill: () => { process.kill(process.pid, 'SIGKILL'); },
    log,
    sleep: (ms) => sleep(ms),
  });
}

for (;;) {
  const detector = new StuckDetector(limits);
  let stuck: ScriptWatch | null = null;
  let last = performance.now();
  while (stuck === null) {
    await sleep(limits.tickMs);
    const now = performance.now();
    const watch = readScriptWatch(shared);
    if (detector.tick(watch, now - last)) stuck = watch;
    last = now;
  }
  await end(stuck);
}
