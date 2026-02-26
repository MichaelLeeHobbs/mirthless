// ===========================================
// User Preferences Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
]);

export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
