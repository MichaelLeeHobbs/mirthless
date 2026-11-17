// ===========================================
// Assignments Table Schema
// ===========================================
// An assignment gives a user a role (D-310). Until group scope arrives (#266)
// every assignment covers all channels. An expired assignment counts for
// nothing: the resolver filters on expires_at, so an expiry takes effect with
// no background job. Only services/grant.service.ts writes this table.

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { roles } from './roles.js';

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reason: text('reason'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('assignments_user_idx').on(table.userId),
  index('assignments_role_idx').on(table.roleId),
]);

export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
