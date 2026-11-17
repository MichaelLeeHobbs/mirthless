// ===========================================
// API Keys Schema
// ===========================================
// A key is its own principal (D-313, RBAC plan section 7): a users row of kind
// 'api_key' that holds one assignment of a private key role, so the resolver,
// the guards, the audit log and the access views treat it like any principal.
// This row holds what only a key has: its secret's hash, who issued it, when it
// ends, and its revocation. Enabling and disabling a key is its user's enabled
// flag. Written only by services/api-key.service.ts.

import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const apiKeys = pgTable('api_keys', {
  /** The key id, the middle of gf_<keyId>_<secret>. */
  id: uuid('id').primaryKey().defaultRandom(),
  /** The principal: a users row of kind 'api_key', one per key. */
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
  /** Its issuer left: the key keeps working until this time unless replaced, then is disabled (D-313). */
  replaceBy: timestamp('replace_by', { withTimezone: true }),
  /** When holders of api_keys:manage were warned that replaceBy is near. */
  replaceWarnedAt: timestamp('replace_warned_at', { withTimezone: true }),
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
