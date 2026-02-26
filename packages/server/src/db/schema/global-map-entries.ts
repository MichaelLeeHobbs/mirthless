// ===========================================
// Global Map Entries Table Schema
// ===========================================
// Persistent key-value store accessible from all channels via globalMap.

import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const globalMapEntries = pgTable('global_map_entries', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalMapEntry = typeof globalMapEntries.$inferSelect;
export type NewGlobalMapEntry = typeof globalMapEntries.$inferInsert;
