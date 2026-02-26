// ===========================================
// Configuration Table Schema
// ===========================================
// Key-value settings for simple server config.

import { pgTable, varchar, text, primaryKey } from 'drizzle-orm/pg-core';

export const configuration = pgTable('configuration', {
  category: varchar('category', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  value: text('value'),
}, (table) => [
  primaryKey({ columns: [table.category, table.name] }),
]);

export type Configuration = typeof configuration.$inferSelect;
export type NewConfiguration = typeof configuration.$inferInsert;
