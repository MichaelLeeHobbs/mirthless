// The protected audit log (D-312). Operational events stay in the events table (event.schema.ts).

import { z } from 'zod/v4';
import { idSchema } from './id.schema.js';

/** Written to audit_log only, never to events. */
export const AUDIT_ACTION = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  /** A guard refused a request, once a minute per caller, route and reason (D-314). */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** Written before the purge runs. */
  EVENTS_PURGED: 'EVENTS_PURGED',
  /** Written by drop_expired_audit_partitions() before it drops months (migration 0017). */
  AUDIT_PARTITIONS_DROPPED: 'AUDIT_PARTITIONS_DROPPED',
  // PHI reads, written fail-closed before the content is sent (lib/audited-read.ts).
  MESSAGE_SEARCHED: 'MESSAGE_SEARCHED',
  MESSAGE_CONTENT_VIEWED: 'MESSAGE_CONTENT_VIEWED',
  MESSAGES_EXPORTED: 'MESSAGES_EXPORTED',
  ATTACHMENT_DOWNLOADED: 'ATTACHMENT_DOWNLOADED',
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
  /** A user's assignments changed, with the role names before and after; written in the change's transaction. */
  ASSIGNMENTS_CHANGED: 'ASSIGNMENTS_CHANGED',
  /** A role was created (with the role it was cloned from), changed, or deleted; written in the change's transaction. */
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
  /** A channel's group memberships changed: who can reach it changed (D-310). Written in the change's transaction. */
  CHANNEL_GROUPS_CHANGED: 'CHANNEL_GROUPS_CHANGED',
  /** An API key was issued, with its permissions, scope and end (D-313); its role and assignment rows follow the usual grant actions. */
  API_KEY_ISSUED: 'API_KEY_ISSUED',
  /** An API key's read was refused at its daily row ceiling; recorded once a day per key (D-313). */
  API_KEY_ROW_CEILING_REACHED: 'API_KEY_ROW_CEILING_REACHED',
  /** An API key's secret was replaced, by whom (now its issuer), and whether the old one still works for a while. */
  API_KEY_REPLACED: 'API_KEY_REPLACED',
  /** A user who issued API keys was disabled or deleted: every key they still issued was disabled, after any taken over (D-322). */
  API_KEYS_OFFBOARDED: 'API_KEYS_OFFBOARDED',
  /** An API key was revoked, with the reason. Revoking also disables the key's user (USER_ENABLED_CHANGED). */
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  /** A user was enabled or disabled (deleting one disables it); written in the change's transaction. */
  USER_ENABLED_CHANGED: 'USER_ENABLED_CHANGED',
  /** A user's email or name changed, with what it was and is now (D-379); written in the change's transaction. */
  USER_DETAILS_CHANGED: 'USER_DETAILS_CHANGED',
  /** Every role, assignment, membership and disabled user, from record_grant_baseline() (migration 0022, the seed): where the access replay starts. */
  GRANT_BASELINE: 'GRANT_BASELINE',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** Recorded in the audit log and the file's header (D-312); one line, so it cannot break out of a CSV header comment. */
export const exportReasonSchema = z.string().trim().min(3, 'Say why you are exporting this (at least 3 characters).').max(500)
  .refine((v) => !/[\r\n]/.test(v), 'The reason must be one line.');

export const backupExportQuerySchema = z.object({ reason: exportReasonSchema });

export type BackupExportQuery = z.infer<typeof backupExportQuerySchema>;

/** `action` is a comma-separated list. */
export const auditListQuerySchema = z.object({
  // A deeper page is a huge OFFSET; filter by date instead.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  action: z.string().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  userId: idSchema.optional(),
  channelId: idSchema.optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

/** Audit rows are keyed by id and the time they occurred (the partition key). */
export const auditIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type AuditIdParam = z.infer<typeof auditIdParamSchema>;
