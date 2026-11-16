// ===========================================
// Job Queue (pgboss)
// ===========================================
// PostgreSQL-backed job queue using pgboss.
// Creates its own 'pgboss' schema — no Drizzle migration needed.

import { PgBoss } from 'pg-boss';
import { config } from '../config/index.js';
import { buildDbSslConfig } from './db.js';
import logger from './logger.js';

let boss: PgBoss | null = null;

export function getBoss(): PgBoss | null {
  return boss;
}

/** Start pg-boss. `getBoss()` returns it only once it has started, never a half-started one. */
export async function startQueue(): Promise<PgBoss> {
  const ssl = buildDbSslConfig();
  const instance = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: 'pgboss',
    ...(ssl ? { ssl } : {}),
  });

  instance.on('error', (err: Error) => {
    logger.error({ errMsg: err.message, stack: err.stack }, 'pgboss error');
  });

  await instance.start();
  boss = instance;
  logger.info({ component: 'pgboss' }, 'pgboss started');
  return instance;
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10_000 });
    boss = null;
    logger.info({ component: 'pgboss' }, 'pgboss stopped');
  }
}
