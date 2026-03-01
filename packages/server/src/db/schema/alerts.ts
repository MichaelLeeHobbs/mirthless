// ===========================================
// Alerts Table Schema
// ===========================================

import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description').default(''),
  enabled: boolean('enabled').notNull().default(true),
  revision: integer('revision').notNull().default(1),
  triggerType: varchar('trigger_type', { length: 30 }).notNull(),
  triggerScript: text('trigger_script'),
  subjectTemplate: text('subject_template'),
  bodyTemplate: text('body_template'),
  reAlertIntervalMs: integer('re_alert_interval_ms'),
  maxAlerts: integer('max_alerts'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertChannels = pgTable('alert_channels', {
  alertId: uuid('alert_id')
    .notNull()
    .references(() => alerts.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.alertId, table.channelId] }),
]);

export const alertActions = pgTable('alert_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id')
    .notNull()
    .references(() => alerts.id, { onDelete: 'cascade' }),
  actionType: varchar('action_type', { length: 30 }).notNull(),
  recipients: jsonb('recipients').notNull().$type<ReadonlyArray<string>>(),
  properties: jsonb('properties').$type<Record<string, unknown>>(),
});

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;
export type AlertAction = typeof alertActions.$inferSelect;
export type NewAlertAction = typeof alertActions.$inferInsert;
