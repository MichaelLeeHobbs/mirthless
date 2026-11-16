// ===========================================
// Audit Log Zod Schemas
// ===========================================
// The protected audit log (D-312): what it records and how it is queried.
// Operational events stay in the events table (event.schema.ts).

import { z } from 'zod/v4';

/** What an audit row records. Each is written to audit_log only, never to events. */
export const AUDIT_ACTION = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  /** A guard refused a request, once a minute per caller, route and reason (D-314). */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** Operational events were purged; written before the purge runs. */
  EVENTS_PURGED: 'EVENTS_PURGED',
  /** Written by drop_expired_audit_partitions() before it drops months (migration 0017). */
  AUDIT_PARTITIONS_DROPPED: 'AUDIT_PARTITIONS_DROPPED',
  // PHI reads, written fail-closed before the content is sent (lib/audited-read.ts).
  MESSAGE_SEARCHED: 'MESSAGE_SEARCHED',
  MESSAGE_CONTENT_VIEWED: 'MESSAGE_CONTENT_VIEWED',
  MESSAGES_EXPORTED: 'MESSAGES_EXPORTED',
  ATTACHMENT_DOWNLOADED: 'ATTACHMENT_DOWNLOADED',
  /** A search across channels (the Traffic page). */
  MESSAGES_SEARCHED_ALL_CHANNELS: 'MESSAGES_SEARCHED_ALL_CHANNELS',
  /** The response of a message sent into a channel from the UI. Fail-closed. */
  MESSAGE_SENT: 'MESSAGE_SENT',
  /** A server backup download, with the file's SHA-256. Fail-closed. */
  SERVER_BACKUP_EXPORTED: 'SERVER_BACKUP_EXPORTED',
  /** A script run against a sample; fail-closed when it returned a result. */
  SCRIPT_TEST_RUN: 'SCRIPT_TEST_RUN',
  // Best-effort reads: a lost record does not refuse the request, and is counted.
  CONFIG_MAP_READ: 'CONFIG_MAP_READ',
  GLOBAL_MAP_READ: 'GLOBAL_MAP_READ',
  COLLECTION_RECORDS_READ: 'COLLECTION_RECORDS_READ',
  SERVER_LOG_READ: 'SERVER_LOG_READ',
  /** A channel or revision read with connector secrets unmasked (channels:write). */
  CHANNEL_SECRETS_READ: 'CHANNEL_SECRETS_READ',
  EVENTS_SEARCHED: 'EVENTS_SEARCHED',
  EVENTS_EXPORTED: 'EVENTS_EXPORTED',
  /** An alert email was sent: who to, never what it said. */
  ALERT_SENT: 'ALERT_SENT',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/**
 * Why an export or backup is being taken (D-312). Required: it is recorded in
 * the audit log and written into the file's header. One line, so it cannot
 * break out of a CSV header comment.
 */
export const exportReasonSchema = z.string().trim().min(3, 'Say why you are exporting this (at least 3 characters).').max(500)
  .refine((v) => !/[\r\n]/.test(v), 'The reason must be one line.');

/** GET /system/backup query string. */
export const backupExportQuerySchema = z.object({ reason: exportReasonSchema });

export type BackupExportQuery = z.infer<typeof backupExportQuerySchema>;

/** GET /audit query filters. `action` is a comma-separated list. */
export const auditListQuerySchema = z.object({
  // A deeper page is a huge OFFSET; filter by date instead.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  action: z.string().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  userId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

/** Audit rows are keyed by id and the time they occurred (the partition key). */
export const auditIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type AuditIdParam = z.infer<typeof auditIdParamSchema>;
