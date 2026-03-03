// ===========================================
// Resources Table Schema
// ===========================================
// Uploaded files available to channels (certs, XSLTs, lookup tables, etc.).
// Note: content uses text as a placeholder until bytea custom type is implemented.

import { pgTable, uuid, varchar, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  mimeType: varchar('mime_type', { length: 100 }),
  sizeBytes: integer('size_bytes').notNull(),
  content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
