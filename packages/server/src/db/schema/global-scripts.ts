// ===========================================
// Global Scripts Table Schema
// ===========================================

import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const globalScripts = pgTable('global_scripts', {
  scriptType: varchar('script_type', { length: 30 }).primaryKey(),
  script: text('script').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalScript = typeof globalScripts.$inferSelect;
export type NewGlobalScript = typeof globalScripts.$inferInsert;
