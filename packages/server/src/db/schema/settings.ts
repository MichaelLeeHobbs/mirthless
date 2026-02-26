// ===========================================
// System Settings Schema
// ===========================================
// Runtime-configurable application settings stored in database.
// No pgEnum — uses varchar for type column.

import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  value: text('value'),
  type: varchar('type', { length: 20 }).notNull().default('string'),
  description: text('description'),
  category: varchar('category', { length: 100 }).default('general'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
