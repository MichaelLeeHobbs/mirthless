// A key is its own principal (D-313): a users row of kind 'api_key' holding one
// assignment of a private key role. Enabling and disabling a key is that user's
// enabled flag. Written only by services/api-key.service.ts.

import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const apiKeys = pgTable('api_keys', {
  /** The key id, the middle of gf_<keyId>_<secret>. */
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description').notNull().default(''),
  /** SHA-256 of the secret (lib/token-hash.ts); the secret is shown once and never stored. */
  secretHash: varchar('secret_hash', { length: 64 }).notNull(),
  /** Who issued it, or last replaced it: the key's grants stay within theirs. */
  issuedBy: uuid('issued_by').notNull().references(() => users.id),
  /** Why the key reads every channel's messages, when it does (D-313). */
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokeReason: text('revoke_reason'),
  /** Written at most once a minute per key (middleware/auth.middleware.ts). */
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: varchar('last_used_ip', { length: 45 }),
  /** After a planned replace: the old secret's hash, working until previousSecretUntil. */
  previousSecretHash: varchar('previous_secret_hash', { length: 64 }),
  previousSecretUntil: timestamp('previous_secret_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('api_keys_issued_by_idx').on(table.issuedBy),
]);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
