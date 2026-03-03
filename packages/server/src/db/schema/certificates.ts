// ===========================================
// Certificates Table Schema
// ===========================================
// SSL/TLS certificates for secure connector communication.

import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  type: varchar('type', { length: 20 }).notNull(),
  certificatePem: text('certificate_pem').notNull(),
  privateKeyPem: text('private_key_pem'),
  fingerprint: varchar('fingerprint', { length: 95 }).notNull(),
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
  notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;
