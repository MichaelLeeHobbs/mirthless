// A server's main thread, reduced to the watchdog and one script. Prints `began` with the time, and
// `finished` when the script ends by itself.

import { existsSync, writeFileSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSandboxContext, VmSandboxExecutor } from '@galvanigraph/engine';
import { watchScript } from '@galvanigraph/engine/script-watch';
import { startScriptWatchdog } from '../../script-watchdog.js';

export interface StuckScriptRun {
  /** `null`: a loop outside the sandbox, which no time limit stops. */
  readonly code: string | null;
  /** How long that loop runs. */
  readonly loopMs: number;
  /** Ends the first loop early once it exists; the child writes `<file>.ended`, then gets stuck for good. */
  readonly stopFile: string | null;
  readonly timeout: number;
  readonly graceMs: number;
  readonly channelId: string | null;
  readonly connectionString: string;
  readonly debugging: boolean;
}

const run = JSON.parse(process.argv[2] ?? '') as StuckScriptRun;
const channelId = run.channelId ?? undefined;
const print = (text: string) => (obj: unknown, msg?: string): void => { writeSync(1, `${text} ${JSON.stringify(obj)} ${msg ?? ''}\n`); };

startScriptWatchdog({
  logger: { warn: print('warn'), error: print('error') },
  db: { connectionString: run.connectionString, ssl: false },
  limits: { graceMs: run.graceMs, tickMs: 100 },
  debugging: () => run.debugging,
});

const { code } = run;
writeSync(1, `began ${String(Date.now())}\n`);
if (code === null) {
  const { stopFile } = run;
  const end = Date.now() + run.loopMs;
  if (stopFile !== null) {
    watchScript(run.timeout, channelId, () => { while (!existsSync(stopFile)) { /* stuck */ } });
    writeFileSync(`${stopFile}.ended`, '');
    await sleep(4_000);
  }
  watchScript(run.timeout, channelId, () => { while (Date.now() < end) { /* stuck */ } });
  writeSync(1, 'finished loop\n');
} else {
  const result = await new VmSandboxExecutor().execute({ code }, createSandboxContext({}, ''), { timeout: run.timeout, channelId });
  writeSync(1, `finished ${result.ok ? 'ok' : result.error.message}\n`);
}
process.exit(0);
