import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';
import * as schema from '../db/schema/index.js';
import logger from './logger.js';

/** Verifies the server certificate unless explicitly opted out: the link carries PHI. */
export function buildDbSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!config.DATABASE_SSL) return false;
  return {
    rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
    ...(config.DATABASE_SSL_CA ? { ca: config.DATABASE_SSL_CA } : {}),
  };
}

/**
 * Without a statement timeout a query stuck behind a lock holds its connection
 * for good, and a pool's worth of those stops the server.
 */
export function buildPoolConfig(): pg.PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: buildDbSslConfig(),
    ...(config.DATABASE_STATEMENT_TIMEOUT_MS > 0 ? { statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS } : {}),
  };
}

const pool = new pg.Pool(buildPoolConfig());

pool.on('error', (err) => {
  logger.error({ errMsg: err.message, stack: err.stack }, 'Unexpected database pool error');
});

export { pool };

export const db = drizzle(pool, { schema });

export default db;
