// ===========================================
// Global Scripts Table Schema
// ===========================================

import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const globalScripts = pgTable('global_scripts', {
  scriptType: varchar('script_type', { length: 30 }).primaryKey(),
  script: text('script').notNull().default(''),
  /** JAVASCRIPT or TYPESCRIPT. Rows from before languages were stored are JavaScript. */
  language: varchar('language', { length: 20 }).notNull().default('JAVASCRIPT'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GlobalScript = typeof globalScripts.$inferSelect;
export type NewGlobalScript = typeof globalScripts.$inferInsert;
