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
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** GET /audit query filters. `action` is a comma-separated list. */
export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
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
