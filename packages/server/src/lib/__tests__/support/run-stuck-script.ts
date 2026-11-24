import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { StuckScriptRun } from './stuck-script-child.js';

const CHILD = fileURLToPath(new URL('./stuck-script-child.ts', import.meta.url));
const SERVER = fileURLToPath(new URL('../../../..', import.meta.url));
/** Kills a child the watchdog did not end; one it ends is gone in seconds. */
const CHILD_DEADLINE_MS = 60_000;

export interface StuckScriptEnd {
  readonly output: string;
  /** The deadline above, not the watchdog, ended it. */
  readonly timedOut: boolean;
  readonly exitedCleanly: boolean;
}

/** By default a script stuck past every deadline here, with a limit of 300 ms and a grace of 1 s. */
export function runStuckScript(run: Partial<StuckScriptRun> & Pick<StuckScriptRun, 'channelId' | 'connectionString'>): Promise<StuckScriptEnd> {
  const full: StuckScriptRun = { code: null, loopMs: 10 * CHILD_DEADLINE_MS, timeout: 300, graceMs: 1_000, debugging: false, stopFile: null, ...run };
  return new Promise((resolve) => {
    let timedOut = false;
    const child = execFile(process.execPath, ['--import', 'tsx', CHILD, JSON.stringify(full)], { cwd: SERVER }, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({ output: stdout + stderr, timedOut, exitedCleanly: error === null });
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, CHILD_DEADLINE_MS);
  });
}
