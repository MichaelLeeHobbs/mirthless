// ===========================================
// Assignment drafts
// ===========================================
// The user dialog edits a user's assignments as drafts: a role, a scope (every
// channel, or chosen groups), an optional expiry in local time and a reason.
// These turn the server's assignments into drafts and back.

import { PERMISSION_CATALOG, allChannelsOnly, type AssignmentInput, type AssignmentView, type Permission } from '@galvanigraph/core-models';

/** One assignment as the editor holds it. */
export interface AssignmentDraft {
  /** Stable key for the row, not sent to the server. */
  readonly key: string;
  readonly roleId: string;
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  /** A `datetime-local` value (local time, no zone), or '' for no expiry. */
  readonly expiresAt: string;
  readonly reason: string;
  /**
   * Already expired on the server, and not renewed here: it grants nothing, and
   * saving the list drops it (the server refuses an end time in the past).
   * Setting a new end time clears this.
   */
  readonly expired: boolean;
}

/** An ISO time as a `datetime-local` value (to the second) in the browser's zone. */
export function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** What saving the rows sends: every row but the expired ones nobody renewed. */
export function toSend(drafts: readonly AssignmentDraft[]): AssignmentInput[] {
  return drafts.filter((d) => !d.expired).map(toInput);
}

/** The server's assignment as an editor row. */
export function toDraft(view: AssignmentView): AssignmentDraft {
  return {
    key: view.id, roleId: view.roleId, groupIds: view.groupIds,
    expiresAt: toLocalInput(view.expiresAt), reason: view.reason ?? '', expired: !view.live,
  };
}

/** An editor row as the server takes it. A blank expiry or reason is none. */
export function toInput(draft: AssignmentDraft): AssignmentInput {
  const expires = draft.expiresAt === '' ? null : new Date(draft.expiresAt);
  return {
    roleId: draft.roleId,
    groupIds: draft.groupIds === null ? null : [...draft.groupIds],
    expiresAt: expires === null || Number.isNaN(expires.getTime()) ? null : expires.toISOString(),
    reason: draft.reason.trim() === '' ? null : draft.reason.trim(),
  };
}

/** Whether two lists of rows would send the same assignments. */
export function sameAssignments(a: readonly AssignmentDraft[], b: readonly AssignmentDraft[]): boolean {
  return JSON.stringify(a.map(toInput)) === JSON.stringify(b.map(toInput));
}

/**
 * Why a role cannot be given on groups, or null when it can: a role holding a
 * permission limited to all-channel assignments (plan section 1).
 */
export function groupScopeBlocked(permissions: readonly string[]): string | null {
  const limited = permissions.filter((p) => Object.hasOwn(PERMISSION_CATALOG, p) && allChannelsOnly(p as Permission));
  return limited.length > 0 ? 'Only on every channel: it holds system-wide permissions' : null;
}
