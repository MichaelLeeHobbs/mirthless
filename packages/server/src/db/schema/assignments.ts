// An assignment gives a user a role over a scope (D-310). Expiry needs no
// background job: the resolver filters on expires_at. Only
// services/grant.service.ts writes these tables.

import { pgTable, uuid, text, timestamp, boolean, index, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { roles } from './roles.js';
import { channelGroups } from './channel-groups.js';

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  /** Every channel. When false, the scope is the groups in assignment_groups. */
  allChannels: boolean('all_channels').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reason: text('reason'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('assignments_user_idx').on(table.userId),
  index('assignments_role_idx').on(table.roleId),
]);

/** Restrict on purpose: deleting a group is refused while any assignment uses it. */
export const assignmentGroups = pgTable('assignment_groups', {
  assignmentId: uuid('assignment_id')
    .notNull()
    .references(() => assignments.id, { onDelete: 'cascade' }),
  channelGroupId: uuid('channel_group_id')
    .notNull()
    .references(() => channelGroups.id, { onDelete: 'restrict' }),
}, (table) => [
  primaryKey({ columns: [table.assignmentId, table.channelGroupId] }),
  index('assignment_groups_group_idx').on(table.channelGroupId),
]);

export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type AssignmentGroup = typeof assignmentGroups.$inferSelect;
