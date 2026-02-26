// ===========================================
// Database Connection
// ===========================================

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';
import * as schema from '../db/schema/index.js';
import logger from './logger.js';

const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected database pool error');
});

export { pool };

export const db = drizzle(pool, { schema });

export default db;
