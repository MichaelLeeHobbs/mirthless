import { PERMISSION_CATALOG, allChannelsOnly, type AssignmentInput, type AssignmentView, type Permission } from '@galvanigraph/core-models';
import { sentDateTimeLocal, toDateTimeLocal } from './datetime-local.js';

export interface AssignmentDraft {
  readonly key: string;
  readonly roleId: string;
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  /** A `datetime-local` value (local time, no zone), or '' for no expiry. */
  readonly expiresAt: string;
  /** The stored end time `expiresAt` was made from; null for a new row. */
  readonly savedExpiresAt: string | null;
  readonly reason: string;
  /**
   * Already expired on the server, and not renewed here: it grants nothing, and
   * saving the list drops it (the server refuses an end time in the past).
   * Setting a new end time clears this.
   */
  readonly expired: boolean;
}

export function toSend(drafts: readonly AssignmentDraft[]): AssignmentInput[] {
  return drafts.filter((d) => !d.expired).map(toInput);
}

export function toDraft(view: AssignmentView): AssignmentDraft {
  return {
    key: view.id, roleId: view.roleId, groupIds: view.groupIds,
    expiresAt: toDateTimeLocal(view.expiresAt), savedExpiresAt: view.expiresAt, reason: view.reason ?? '', expired: !view.live,
  };
}

export function toInput(draft: AssignmentDraft): AssignmentInput {
  return {
    roleId: draft.roleId,
    groupIds: draft.groupIds === null ? null : [...draft.groupIds],
    expiresAt: sentDateTimeLocal(draft.expiresAt, draft.savedExpiresAt),
    reason: draft.reason.trim() === '' ? null : draft.reason.trim(),
  };
}

export function sameAssignments(a: readonly AssignmentDraft[], b: readonly AssignmentDraft[]): boolean {
  return JSON.stringify(a.map(toInput)) === JSON.stringify(b.map(toInput));
}

export function groupScopeBlocked(permissions: readonly string[]): string | null {
  const limited = permissions.filter((p) => Object.hasOwn(PERMISSION_CATALOG, p) && allChannelsOnly(p as Permission));
  return limited.length > 0 ? 'Only on every channel: it holds system-wide permissions' : null;
}
