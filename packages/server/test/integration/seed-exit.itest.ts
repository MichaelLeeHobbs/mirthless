// ===========================================
// Seed script exit — real Postgres integration
// ===========================================
// `pnpm db:seed` must exit as soon as it has seeded. The example-message step
// writes through the server's own pool (lib/db.ts), whose idle connections
// kept node alive for idleTimeoutMillis (30s) after "Seed complete", which
// CI paid on every e2e run.
//
// Runs the real script as a child process against the *_test database. The
// seed is idempotent, and seed-example-messages.itest.ts already seeds the
// demo content into this database.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { describeIntegration } from './_setup.js';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Well under the 30s pool idle timeout, well over a seed run. */
const EXIT_LIMIT_MS = 15_000;

interface SeedRun { readonly code: number | null; readonly elapsedMs: number; readonly output: string }

function runSeed(): Promise<SeedRun> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/db/seeds/run-seed.ts'], {
      cwd: SERVER_DIR,
      env: { ...process.env, SEED_DEMO_DATA: 'true' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const killer = setTimeout(() => child.kill(), EXIT_LIMIT_MS * 3);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, elapsedMs: Date.now() - started, output });
    });
  });
}

describeIntegration('Seed script (real Postgres)', () => {
  it('exits promptly after seeding the demo content', async () => {
    const run = await runSeed();

    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('Seeding example messages');
    expect(run.elapsedMs, `seed took ${String(run.elapsedMs)}ms to exit`).toBeLessThan(EXIT_LIMIT_MS);
  }, EXIT_LIMIT_MS * 4);
});
