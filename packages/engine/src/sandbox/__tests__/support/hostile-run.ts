import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { HostileCase, HostileOutcome, HostileRun } from './hostile-script-child.js';

const CHILD = fileURLToPath(new URL('./hostile-script-child.ts', import.meta.url));
const ENGINE = fileURLToPath(new URL('../../../..', import.meta.url));
/** A case takes a second, and a worker's on a busy machine as long as its limits: 60 s to start, then 35 s. */
const SILENT_MS = 120_000;
/** For a child that hangs, and one that answers slowly but goes on. */
export const CHILD_HOOK_TIMEOUT_MS = 5 * SILENT_MS;

export interface ChildRun {
  /** A case is missing from here when the process hung or died before it was done. */
  readonly outcomes: ReadonlyMap<string, HostileOutcome>;
  readonly end: string;
}

export function runHostileScripts(mode: HostileRun['mode'], cases: readonly HostileCase[]): Promise<ChildRun> {
  const run: HostileRun = { mode, cases };
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ['--expose-gc', '--import', 'tsx', CHILD, JSON.stringify(run)],
      { cwd: ENGINE },
      (err, stdout, stderr) => {
        clearTimeout(hung);
        // What follows the last newline is empty, or a line the child was killed while writing.
        const lines = stdout.split('\n').slice(0, -1).map((l) => JSON.parse(l) as HostileOutcome);
        const end = err === null ? 'exited normally'
          : err.killed === true ? 'hung and was killed'
            : `ended with ${String(err.code)}: ${stderr.slice(0, 300)}`;
        resolve({ outcomes: new Map(lines.map((l) => [l.name, l])), end });
      },
    );
    const hung = setTimeout(() => { child.kill('SIGKILL'); }, SILENT_MS);
    child.stdout?.on('data', () => { hung.refresh(); });
  });
}
