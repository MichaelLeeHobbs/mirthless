// The server pool's idle connections (lib/db.ts) once kept `pnpm db:seed` alive
// for idleTimeoutMillis (30s) after seeding, which every CI e2e run paid.
// The seed is idempotent, so running it on the *_test database is safe.
// Only "Seed finished." to exit is timed: start-up and seeding vary with
// machine load (#248, D-290).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** The line run-seed.ts prints once every pool is closed. */
const SEED_FINISHED = 'Seed finished.';

/** From "Seed finished." to exit: well under the 30s pool idle timeout a leaked pool holds the process for. */
const EXIT_LIMIT_MS = 10_000;

/** Start-up plus seeding, however slow the machine: only a backstop for a hung child. */
const RUN_LIMIT_MS = 120_000;

interface SeedRun {
  readonly code: number | null;
  readonly output: string;
  readonly exitAfterFinishMs: number | null;
}

function runSeed(): Promise<SeedRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/seeds/run-seed.ts'], {
      cwd: SERVER_DIR,
      env: { ...process.env, SEED_DEMO_DATA: 'true' },
    });
    let output = '';
    let finishedAt: number | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (finishedAt === null && output.includes(SEED_FINISHED)) { finishedAt = Date.now(); }
    });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const killer = setTimeout(() => child.kill(), RUN_LIMIT_MS);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, output, exitAfterFinishMs: finishedAt === null ? null : Date.now() - finishedAt });
    });
  });
}

describeIntegration('Seed script (real Postgres)', () => {
  it('exits promptly once seeding the demo content is finished', async () => {
    const run = await runSeed();

    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('Seeding example messages');
    expect(run.exitAfterFinishMs, run.output).not.toBeNull();
    expect(run.exitAfterFinishMs, `seed exited ${String(run.exitAfterFinishMs)}ms after "${SEED_FINISHED}"`)
      .toBeLessThan(EXIT_LIMIT_MS);
  }, RUN_LIMIT_MS + 10_000);
});
