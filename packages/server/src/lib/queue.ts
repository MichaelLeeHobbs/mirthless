import { PgBoss } from 'pg-boss';
import { tryCatch } from 'stderr-lib';
import { config } from '../config/index.js';
import { PG_BOSS_SCHEMA } from '../db/runtime-role.js';
import { buildDbSslConfig } from './db.js';
import logger from './logger.js';

let boss: PgBoss | null = null;
/** Held so shutdown can stop a start() that hangs. */
let starting: PgBoss | null = null;

export function getBoss(): PgBoss | null {
  return boss;
}

async function stopQuietly(instance: PgBoss): Promise<void> {
  const stopped = await tryCatch(() => instance.stop({ graceful: false, timeout: 10_000 }));
  if (!stopped.ok) {
    logger.warn({ component: 'pgboss', errMsg: stopped.error.message }, 'Could not stop a pgboss that did not start');
  }
}

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
