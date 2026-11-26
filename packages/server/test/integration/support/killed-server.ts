// A server that dies in the middle of a message: a process of its own, killed while a script of the
// message waits for the resources table, which the test holds locked (`getResource` reads it).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waitForBlocked, type ServerModules } from '../_setup.js';

const CHILD = fileURLToPath(new URL('./starting-server-child.ts', import.meta.url));
const SERVER = fileURLToPath(new URL('../../..', import.meta.url));
/** A child loads the whole server through tsx first, as one that gets 60 s in restart-deploys-recorded does. */
export const START_TIMEOUT_MS = 60_000;

/** A script that waits while the table is locked. */
export const WAITS_FOR_THE_LOCK = "try { await getResource('none'); } catch (e) { /* it has none */ }";

/** Start a server, which redeploys the recorded deployments, and kill it once a script waits for the lock. */
export async function startAndDie(pool: ServerModules['pool']): Promise<void> {
  const locker = await pool.connect();
  try {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE resources IN ACCESS EXCLUSIVE MODE');
    await dieOnceBlocked(pool);
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
  }
}

async function dieOnceBlocked(pool: ServerModules['pool']): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD], { cwd: SERVER, stdio: 'pipe' });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const ended = new Promise<Error>((resolve) => {
    child.once('error', resolve);
    child.once('close', (code, signal) => { resolve(new Error(`The server ended by itself (${String(code ?? signal)}): ${output}`)); });
  });
  let early: Error | null;
  try {
    early = await Promise.race([waitForBlocked(pool, 'select %"resources"', START_TIMEOUT_MS).then(() => null), ended]);
  } catch (err) {
    throw new Error(`${String(err)}: ${output}`, { cause: err });
  } finally {
    child.kill('SIGKILL');
    await ended;
  }
  if (early !== null) throw early;
}
