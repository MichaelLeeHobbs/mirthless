// ===========================================
// Channel Deployments Table Schema
// ===========================================
// What each channel's last deploy deployed, so a restart brings back exactly
// that and never the saved configuration nobody deployed (#225, D-328).
// One row per channel, replaced at each deploy; CHANNEL_DEPLOYED events keep
// the history of who deployed what and when.

import { pgTable, uuid, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';

export const channelDeployments = pgTable('channel_deployments', {
  channelId: uuid('channel_id').primaryKey().references(() => channels.id, { onDelete: 'cascade' }),
  /** The channel's revision when it was deployed. */
  channelRevision: integer('channel_revision').notNull(),
  /**
   * The layout of the stored bundle. A version that cannot read a row's format
   * refuses to deploy it rather than guess (see deployment-record.service.ts).
   */
  format: integer('format').notNull(),
  /** The channel configuration deployed, as ChannelService.getById returned it (secrets included). */
  channel: jsonb('channel').notNull().$type<Record<string, unknown>>(),
  /** The code templates compiled into it: id, name, revision, code, type, contexts. */
  codeTemplates: jsonb('code_templates').notNull().$type<ReadonlyArray<Record<string, unknown>>>(),
  /** The global scripts compiled into it, with their languages. */
  globalScripts: jsonb('global_scripts').notNull().$type<Record<string, unknown>>(),
  deployedBy: uuid('deployed_by'),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set when someone undeploys the channel: a restart does not bring it back. Cleared by the next deploy. */
  undeployedAt: timestamp('undeployed_at', { withTimezone: true }),
});

/**
 * Channels that existed, enabled, when the upgrade adding deployment records
 * ran. The first start after it deploys each one's saved configuration and
 * records it, once (D-328). Rows are removed as each channel is adopted.
 */
export const channelDeploymentAdoptions = pgTable('channel_deployment_adoptions', {
  channelId: uuid('channel_id').primaryKey().references(() => channels.id, { onDelete: 'cascade' }),
});

export type ChannelDeploymentRow = typeof channelDeployments.$inferSelect;
