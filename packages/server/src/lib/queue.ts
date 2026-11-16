// ===========================================
// Job Queue (pgboss)
// ===========================================
// PostgreSQL-backed job queue using pgboss.
// Migration 0016 creates the 'pgboss' schema and pg-boss creates its tables in
// it. In the Docker stack the server's database role owns that schema (D-307):
// pg-boss creates, migrates and maintains its tables while the server runs.

import { PgBoss } from 'pg-boss';
import { config } from '../config/index.js';
import { PG_BOSS_SCHEMA } from '../db/runtime-role.js';
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
    schema: PG_BOSS_SCHEMA,
    // Migration 0016 creates the schema; creating it here would need CREATE on
    // the database, which the server's role does not have (D-307).
    createSchema: false,
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
