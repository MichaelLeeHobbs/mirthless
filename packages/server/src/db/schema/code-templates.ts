// ===========================================
// Code Templates Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const codeTemplateLibraries = pgTable('code_template_libraries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const codeTemplates = pgTable('code_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  libraryId: uuid('library_id')
    .notNull()
    .references(() => codeTemplateLibraries.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').default(''),
  type: varchar('type', { length: 20 }).notNull(),
  code: text('code').notNull().default(''),
  contexts: jsonb('contexts').notNull().$type<ReadonlyArray<string>>(),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CodeTemplateLibrary = typeof codeTemplateLibraries.$inferSelect;
export type NewCodeTemplateLibrary = typeof codeTemplateLibraries.$inferInsert;
export type CodeTemplate = typeof codeTemplates.$inferSelect;
export type NewCodeTemplate = typeof codeTemplates.$inferInsert;
