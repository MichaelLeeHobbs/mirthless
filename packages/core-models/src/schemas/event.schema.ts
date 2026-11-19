// ===========================================
// Event Zod Schemas
// ===========================================
// Validation schemas for querying, creating, and purging audit events.

import { z } from 'zod/v4';

// ----- Const Objects -----
// EVENT_LEVEL and EVENT_OUTCOME are defined in constants.ts

export const EVENT_NAME = {
  // Sign-ins, sign-outs, refusals and purges go to audit_log: AUDIT_ACTION in audit.schema.ts.
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  CHANNEL_CREATED: 'CHANNEL_CREATED',
  CHANNEL_UPDATED: 'CHANNEL_UPDATED',
  CHANNEL_DELETED: 'CHANNEL_DELETED',
  CHANNEL_DEPLOYED: 'CHANNEL_DEPLOYED',
  CHANNEL_UNDEPLOYED: 'CHANNEL_UNDEPLOYED',
  CHANNEL_STARTED: 'CHANNEL_STARTED',
  CHANNEL_STOPPED: 'CHANNEL_STOPPED',
  CHANNEL_PAUSED: 'CHANNEL_PAUSED',
  CHANNEL_ENABLED: 'CHANNEL_ENABLED',
  CHANNEL_DISABLED: 'CHANNEL_DISABLED',
  // At startup: an enabled channel was not deployed because it has no usable
  // deployment record (never deployed, or a record this version cannot read) (#225).
  CHANNEL_NOT_REDEPLOYED: 'CHANNEL_NOT_REDEPLOYED',
  // First start after the upgrade that added deployment records: the saved
  // configuration was deployed and recorded as the channel's deployment (#225).
  CHANNEL_DEPLOYMENT_ADOPTED: 'CHANNEL_DEPLOYMENT_ADOPTED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  CODE_TEMPLATE_UPDATED: 'CODE_TEMPLATE_UPDATED',
  GLOBAL_SCRIPT_UPDATED: 'GLOBAL_SCRIPT_UPDATED',
  ALERT_UPDATED: 'ALERT_UPDATED',
  GLOBAL_MAP_UPDATED: 'GLOBAL_MAP_UPDATED',
  CONFIG_MAP_UPDATED: 'CONFIG_MAP_UPDATED',
  COLLECTION_UPDATED: 'COLLECTION_UPDATED',
  DATASOURCE_UPDATED: 'DATASOURCE_UPDATED',
  // Message reads, searches, exports and attachment downloads are PHI reads in
  // audit_log: AUDIT_ACTION in audit.schema.ts.
  CHANNEL_EXPORTED: 'CHANNEL_EXPORTED',
  MESSAGE_REPROCESSED: 'MESSAGE_REPROCESSED',
  MESSAGES_REPROCESSED: 'MESSAGES_REPROCESSED',
  MESSAGE_RESEND_QUEUED: 'MESSAGE_RESEND_QUEUED',
  // An API key has read 80% of its daily row ceiling (#301); once per key per UTC day.
  API_KEY_ROW_CEILING_WARNING: 'API_KEY_ROW_CEILING_WARNING',
  // Backup downloads and script test runs are in audit_log (AUDIT_ACTION).
} as const;

export type EventName = (typeof EVENT_NAME)[keyof typeof EVENT_NAME];

// ----- Query Schema -----

/** GET /events query string filters. */
export const eventListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  level: z.string().optional(),
  name: z.string().optional(),
  outcome: z.string().optional(),
  userId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type EventListQuery = z.infer<typeof eventListQuerySchema>;

// ----- Param Schema -----

/** Events use bigserial integer IDs. */
export const eventIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type EventIdParam = z.infer<typeof eventIdParamSchema>;

// ----- Create Event Input -----

/** Internal use — not a public API endpoint. */
export const createEventInputSchema = z.object({
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  name: z.string().min(1).max(100),
  outcome: z.enum(['SUCCESS', 'FAILURE']),
  userId: z.string().uuid().nullable().default(null),
  channelId: z.string().uuid().nullable().default(null),
  serverId: z.string().max(36).nullable().default(null),
  ipAddress: z.string().max(45).nullable().default(null),
  attributes: z.record(z.string(), z.unknown()).nullable().default(null),
});

export type CreateEventInput = z.infer<typeof createEventInputSchema>;

// ----- Purge Schema -----

/** DELETE /events?olderThanDays=90 */
export const purgeEventsSchema = z.object({
  olderThanDays: z.coerce.number().int().positive().min(1),
});

export type PurgeEventsQuery = z.infer<typeof purgeEventsSchema>;
