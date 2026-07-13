// ===========================================
// Collections Table Schema
// ===========================================
// A Collection is a durable, queryable, TTL-pruned keyed record store that
// channel scripts read/write via getCollection(). See docs/design/10-collections.md.

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';

/** A collection definition (the schema for a set of records). */
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').notNull().default(''),
  /** Field names records may be matched/filtered on (string[]). */
  indexedFields: jsonb('indexed_fields').notNull().$type<readonly string[]>(),
  /** Default record lifetime in seconds; null = never expire. */
  defaultTtlSeconds: integer('default_ttl_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

/** One stored record. Append-only — many records may share the same field values. */
export const collectionRecords = pgTable('collection_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  /** Indexed field values supplied at write time. */
  fields: jsonb('fields').notNull().$type<Record<string, string | number | boolean>>(),
  /** Opaque stored value — scripts parse it. */
  payload: text('payload'),
  /** When the pruner removes this record; null = never. */
  expireAt: timestamp('expire_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // GIN over fields for @> containment (equality match on any subset).
  index('collection_records_fields_idx').using('gin', table.fields),
  // Newest-wins hot path: exact key group then newest first.
  index('collection_records_created_idx').on(table.collectionId, table.createdAt.desc()),
  // Pruner scan over expiring rows only.
  index('collection_records_expire_idx').on(table.expireAt).where(sql`expire_at is not null`),
]);

export type CollectionRecord = typeof collectionRecords.$inferSelect;
export type NewCollectionRecord = typeof collectionRecords.$inferInsert;
