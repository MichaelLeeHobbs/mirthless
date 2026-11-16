// ===========================================
// Job Queue (pgboss)
// ===========================================
// PostgreSQL-backed job queue using pgboss.
// Migration 0016 creates the 'pgboss' schema and pg-boss creates its tables in
// it. In the Docker stack the server's database role owns that schema (D-307):
// pg-boss creates, migrates and maintains its tables while the server runs.

import { PgBoss } from 'pg-boss';
import { tryCatch } from 'stderr-lib';
import { config } from '../config/index.js';
import { PG_BOSS_SCHEMA } from '../db/runtime-role.js';
import { buildDbSslConfig } from './db.js';
import logger from './logger.js';

let boss: PgBoss | null = null;
/** An instance whose start() has not settled, so shutdown can stop a start that hangs. */
let starting: PgBoss | null = null;

export function getBoss(): PgBoss | null {
  return boss;
}

/** Stop an instance that is not (or not yet) the running queue; a failure is logged, not thrown. */
async function stopQuietly(instance: PgBoss): Promise<void> {
  const stopped = await tryCatch(() => instance.stop({ graceful: false, timeout: 10_000 }));
  if (!stopped.ok) {
    logger.warn({ component: 'pgboss', errMsg: stopped.error.message }, 'Could not stop a pgboss that did not start');
  }
}

/**
 * Start pg-boss. `getBoss()` returns it only once it has started, never a
 * half-started one. A start that fails is stopped, so it leaves no pool or
 * timers behind; a start still running at shutdown is stopped by `stopQueue`.
 */
export async function startQueue(): Promise<PgBoss> {
  const ssl = buildDbSslConfig();
  const instance = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: PG_BOSS_SCHEMA,
    // Migration 0016 creates the schema; creating it here would need CREATE on
    // the database, which the server's role does not have (D-307).
    createSchema: false,
    ...(ssl ? { ssl } : {}),
  });

  instance.on('error', (err: Error) => {
    logger.error({ errMsg: err.message, stack: err.stack }, 'pgboss error');
  });

  starting = instance;
  const started = await tryCatch(() => instance.start());
  const stoppedWhileStarting = starting !== instance;
  if (!stoppedWhileStarting) starting = null;
  if (!started.ok) {
    if (!stoppedWhileStarting) await stopQuietly(instance);
    throw started.error;
  }
  if (stoppedWhileStarting) {
    throw new Error('pgboss was stopped while it was starting');
  }
  boss = instance;
  logger.info({ component: 'pgboss' }, 'pgboss started');
  return instance;
}

export async function stopQueue(): Promise<void> {
  if (starting) {
    const instance = starting;
    starting = null;
    await stopQuietly(instance);
    logger.info({ component: 'pgboss' }, 'pgboss stopped while it was still starting');
  }
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10_000 });
    boss = null;
    logger.info({ component: 'pgboss' }, 'pgboss stopped');
  }
}
