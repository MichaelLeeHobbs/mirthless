// ===========================================
// Database Connection
// ===========================================

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';
import * as schema from '../db/schema/index.js';
import logger from './logger.js';

/**
 * Build the pg TLS config. When DATABASE_SSL is on we VERIFY the server cert by
 * default (previously verification was disabled, leaving the PHI link MITM-able).
 * Supply DATABASE_SSL_CA for a private CA, or explicitly set
 * DATABASE_SSL_REJECT_UNAUTHORIZED=false to opt out (insecure).
 */
export function buildDbSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!config.DATABASE_SSL) return false;
  return {
    rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
    ...(config.DATABASE_SSL_CA ? { ca: config.DATABASE_SSL_CA } : {}),
  };
}

const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: buildDbSslConfig(),
});

pool.on('error', (err) => {
  logger.error({ errMsg: err.message, stack: err.stack }, 'Unexpected database pool error');
});

export { pool };

export const db = drizzle(pool, { schema });

export default db;
