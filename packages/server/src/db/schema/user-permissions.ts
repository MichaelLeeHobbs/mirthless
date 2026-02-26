// ===========================================
// User Permissions Table Schema
// ===========================================

import { pgTable, uuid, varchar, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const userPermissions = pgTable('user_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  resource: varchar('resource', { length: 50 }).notNull(),
  action: varchar('action', { length: 20 }).notNull(),
  scope: jsonb('scope').notNull().$type<'all' | ReadonlyArray<string>>(),
}, (table) => [
  index('user_permissions_user_idx').on(table.userId),
]);

export type UserPermission = typeof userPermissions.$inferSelect;
export type NewUserPermission = typeof userPermissions.$inferInsert;
