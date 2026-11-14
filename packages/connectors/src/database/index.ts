// ===========================================
// Database Connector Exports
// ===========================================

export { prepare, type PreparedQuery, type PlaceholderStyle } from './query-builder.js';
export { ConnectionPool, type DatabasePool, type PoolConfig, type QueryResult } from './connection-pool.js';
export { MysqlPool } from './mysql-pool.js';
export { DATABASE_VENDOR, createPool, type DatabaseVendor } from './database-vendor.js';
export {
  DatabaseReceiver,
  UPDATE_MODE,
  ROW_FORMAT,
  type DatabaseReceiverConfig,
  type UpdateMode,
  type RowFormat,
} from './database-receiver.js';
export {
  DatabaseDispatcher,
  type DatabaseDispatcherConfig,
} from './database-dispatcher.js';
