// ===========================================
// Database Vendors
// ===========================================
// Which database a Database Reader or Writer talks to. The names are the JDBC
// URL schemes Mirth uses (jdbc:postgresql:, jdbc:mysql:).

import { ConnectionPool, type DatabasePool } from './connection-pool.js';
import { MysqlPool } from './mysql-pool.js';
import type { PlaceholderStyle } from './query-builder.js';

export const DATABASE_VENDOR = {
  POSTGRESQL: 'postgresql',
  MYSQL: 'mysql',
} as const;
export type DatabaseVendor = (typeof DATABASE_VENDOR)[keyof typeof DATABASE_VENDOR];

/** A new, not yet created, pool for the vendor. */
export function createPool(vendor: DatabaseVendor): DatabasePool {
  return vendor === DATABASE_VENDOR.MYSQL ? new MysqlPool() : new ConnectionPool();
}

/** How the vendor's driver writes query parameters: `$1` for pg, `?` for mysql2. */
export function placeholderStyle(vendor: DatabaseVendor): PlaceholderStyle {
  return vendor === DATABASE_VENDOR.MYSQL ? 'question' : 'numbered';
}
