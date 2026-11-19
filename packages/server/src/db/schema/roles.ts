// A role is a named set of permissions (D-310). The admin role has no
// role_permissions rows: its holders get every permission, so a permission
// added later reaches admins without a migration. Only
// services/grant.service.ts writes these tables.

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, boolean, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description').notNull().default(''),
  builtIn: boolean('built_in').notNull().default(false),
  /** The locked admin role: every permission, never edited or deleted. */
  admin: boolean('admin').notNull().default(false),
  /** One API key's private role (D-313): never listed with the roles, edited through the role routes or given to a person. */
  keyRole: boolean('key_role').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // At most one admin role: the last-admin lock and the resolver assume it.
  uniqueIndex('roles_one_admin_idx').on(table.admin).where(sql`${table.admin}`),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  permission: varchar('permission', { length: 64 }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permission] }),
  index('role_permissions_permission_idx').on(table.permission),
]);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
