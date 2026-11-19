import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, boolean, integer, index, check } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  description: text('description'),
  // A user's roles are assignments (db/schema/assignments.ts, D-310).
  /**
   * 'person', or 'api_key': the principal behind an API key (db/schema/api-keys.ts,
   * D-313). A key's user never signs in with a password, is never listed or
   * picked as a person, and its enabled flag is the key's.
   */
  kind: varchar('kind', { length: 16 }).notNull().default('person'),
  enabled: boolean('enabled').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('users_enabled_idx').on(table.enabled),
  check('users_kind_check', sql`${table.kind} IN ('person', 'api_key')`),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
