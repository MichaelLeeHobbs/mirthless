// ===========================================
// Grant replay
// ===========================================
// Rebuilds who held which roles over which groups at a past moment from the
// grant rows in audit_log (RBAC plan section 8, slice 11b): start from a
// GRANT_BASELINE snapshot (written by record_grant_baseline(), migration 0022
// and the seed) and apply each later grant row, oldest first. Every grant
// write records its full after state, so each row replaces what it names.
//
// A row this cannot read throws, naming the row: an access answer built on a
// skipped row would be wrong without saying so.

import { z } from 'zod/v4';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { ServiceError } from './service-error.js';

/** The audit actions the replay reads; the partial index in migration 0022 covers the same list. */
export const GRANT_REPLAY_ACTIONS = [
  AUDIT_ACTION.GRANT_BASELINE,
  AUDIT_ACTION.ASSIGNMENTS_CHANGED,
  AUDIT_ACTION.CHANNEL_GROUPS_CHANGED,
  AUDIT_ACTION.ROLE_CREATED,
  AUDIT_ACTION.ROLE_UPDATED,
  AUDIT_ACTION.ROLE_DELETED,
  AUDIT_ACTION.USER_ENABLED_CHANGED,
] as const;

/** One audit row, as the replay reads it. */
export interface GrantAuditRow {
  readonly id: number;
  readonly action: string;
  readonly channelId: string | null;
  readonly attributes: unknown;
}

export interface ReplayedRole { readonly name: string; readonly admin: boolean; readonly permissions: readonly string[] }
export interface ReplayedAssignment { readonly roleId: string; readonly groupIds: readonly string[] | null; readonly expiresAt: string | null }

/** The grant tables as they stood after the last row replayed. */
export interface ReplayedGrants {
  readonly roles: Map<string, ReplayedRole>;
  /** By user id. */
  readonly assignments: Map<string, readonly ReplayedAssignment[]>;
  /** Group ids by channel id. */
  readonly memberships: Map<string, readonly string[]>;
  readonly disabled: Set<string>;
}

const ids = z.array(z.string());
const baselineSchema = z.object({
  roles: z.array(z.object({ id: z.string(), name: z.string(), admin: z.boolean(), permissions: ids })),
  assignments: z.array(z.object({ userId: z.string(), roleId: z.string(), groupIds: ids.nullable(), expiresAt: z.string().nullable() })),
  memberships: z.array(z.object({ channelId: z.string(), groupIds: ids })),
  disabledUserIds: ids,
});
const roleState = z.object({ name: z.string(), permissions: ids });
const assignmentSummary = z.object({
  roleId: z.string().optional(), role: z.string(), scope: z.union([z.literal('all'), ids]), expiresAt: z.string().nullable().optional(),
});
const ROW_SCHEMAS = {
  [AUDIT_ACTION.ASSIGNMENTS_CHANGED]: z.object({ targetUserId: z.string(), after: z.array(assignmentSummary) }),
  [AUDIT_ACTION.CHANNEL_GROUPS_CHANGED]: z.object({ after: ids }),
  [AUDIT_ACTION.ROLE_CREATED]: z.object({ roleId: z.string(), name: z.string(), permissions: ids }),
  [AUDIT_ACTION.ROLE_UPDATED]: z.object({ roleId: z.string(), after: roleState }),
  [AUDIT_ACTION.ROLE_DELETED]: z.object({ roleId: z.string() }),
  [AUDIT_ACTION.USER_ENABLED_CHANGED]: z.object({ targetUserId: z.string(), enabled: z.boolean() }),
} as const;
type ReplayedAction = keyof typeof ROW_SCHEMAS;

function unreadable(what: string): ServiceError {
  return new ServiceError('INTERNAL', `The access history cannot be rebuilt: ${what}`);
}

/** The state a GRANT_BASELINE row's attributes hold. */
function fromBaseline(attributes: unknown): ReplayedGrants {
  const parsed = baselineSchema.safeParse(attributes);
  if (!parsed.success) throw unreadable('the grant baseline is not readable');
  const b = parsed.data;
  const assignments = new Map<string, ReplayedAssignment[]>();
  for (const a of b.assignments) {
    assignments.set(a.userId, [...(assignments.get(a.userId) ?? []), { roleId: a.roleId, groupIds: a.groupIds, expiresAt: a.expiresAt }]);
  }
  return {
    roles: new Map(b.roles.map((r) => [r.id, { name: r.name, admin: r.admin, permissions: [...r.permissions].sort() }])),
    assignments,
    memberships: new Map(b.memberships.map((m) => [m.channelId, [...m.groupIds].sort()])),
    disabled: new Set(b.disabledUserIds),
  };
}

/** The role an assignment row means: its id when it carries one, else the role of that name at that point. */
function roleIdFor(state: ReplayedGrants, summary: z.infer<typeof assignmentSummary>, rowId: number): string {
  if (summary.roleId !== undefined) return summary.roleId;
  for (const [id, role] of state.roles) if (role.name === summary.role) return id;
  throw unreadable(`audit row ${String(rowId)} assigns role "${summary.role}", which no earlier row defines`);
}

/** A row's attributes read with `action`'s schema, or a loud failure naming the row. */
function read<A extends ReplayedAction>(row: GrantAuditRow, action: A): z.infer<(typeof ROW_SCHEMAS)[A]> {
  const parsed = ROW_SCHEMAS[action].safeParse(row.attributes);
  if (!parsed.success) throw unreadable(`audit row ${String(row.id)} (${action}) is not readable`);
  return parsed.data as z.infer<(typeof ROW_SCHEMAS)[A]>;
}

function setRole(state: ReplayedGrants, roleId: string, name: string, permissions: readonly string[]): void {
  state.roles.set(roleId, { name, admin: state.roles.get(roleId)?.admin ?? false, permissions: [...permissions].sort() });
}

/** Apply one grant row to `state`. */
function apply(state: ReplayedGrants, row: GrantAuditRow, action: ReplayedAction): void {
  switch (action) {
    case AUDIT_ACTION.ASSIGNMENTS_CHANGED: {
      const a = read(row, action);
      state.assignments.set(a.targetUserId, a.after.map((s) => ({
        roleId: roleIdFor(state, s, row.id), groupIds: s.scope === 'all' ? null : [...s.scope].sort(), expiresAt: s.expiresAt ?? null,
      })));
      return;
    }
    case AUDIT_ACTION.CHANNEL_GROUPS_CHANGED: {
      const a = read(row, action);
      if (row.channelId === null) throw unreadable(`audit row ${String(row.id)} changes groups but names no channel`);
      state.memberships.set(row.channelId, [...a.after].sort());
      return;
    }
    case AUDIT_ACTION.ROLE_CREATED: { const a = read(row, action); setRole(state, a.roleId, a.name, a.permissions); return; }
    case AUDIT_ACTION.ROLE_UPDATED: { const a = read(row, action); setRole(state, a.roleId, a.after.name, a.after.permissions); return; }
    case AUDIT_ACTION.ROLE_DELETED: { state.roles.delete(read(row, action).roleId); return; }
    case AUDIT_ACTION.USER_ENABLED_CHANGED: {
      const a = read(row, action);
      if (a.enabled) state.disabled.delete(a.targetUserId); else state.disabled.add(a.targetUserId);
      return;
    }
    default: {
      const unhandled: never = action;
      throw unreadable(`audit row ${String(row.id)} has action ${String(unhandled)}, which the replay does not know`);
    }
  }
}

function isReplayed(action: string): action is ReplayedAction {
  return Object.hasOwn(ROW_SCHEMAS, action);
}

/**
 * The grant tables after `rows` (oldest first, all later than the baseline)
 * are applied to `baseline` (a GRANT_BASELINE row's attributes). Rows of other
 * actions are skipped. Throws INTERNAL on anything it cannot read.
 */
export function replayGrants(baseline: unknown, rows: readonly GrantAuditRow[]): ReplayedGrants {
  const state = fromBaseline(baseline);
  for (const row of rows) if (isReplayed(row.action)) apply(state, row, row.action);
  return state;
}
