// ===========================================
// Job Queue (pgboss)
// ===========================================
// PostgreSQL-backed job queue using pgboss.
// Creates its own 'pgboss' schema — no Drizzle migration needed.

import { PgBoss } from 'pg-boss';
import { config } from '../config/index.js';
import logger from './logger.js';

let boss: PgBoss | null = null;

export function getBoss(): PgBoss | null {
  return boss;
}

export async function startQueue(): Promise<PgBoss> {
  boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: 'pgboss',
    ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  boss.on('error', (err: Error) => {
    logger.error({ errMsg: err.message, stack: err.stack }, 'pgboss error');
  });

  await boss.start();
  logger.info({ component: 'pgboss' }, 'pgboss started');
  return boss;
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10_000 });
    boss = null;
    logger.info({ component: 'pgboss' }, 'pgboss stopped');
  }
}
