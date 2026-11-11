// ===========================================
// Global Map Entries Table Schema
// ===========================================
// Persistent key-value store accessible from all channels via globalMap.

import { pgTable, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const globalMapEntries = pgTable('global_map_entries', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value'),
  /** False: `value` is plain text. True: a script stored a non-text value, kept as JSON. */
  isJson: boolean('is_json').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalMapEntry = typeof globalMapEntries.$inferSelect;
export type NewGlobalMapEntry = typeof globalMapEntries.$inferInsert;
