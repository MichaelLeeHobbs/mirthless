// ===========================================
// API keys (UI)
// ===========================================
// What the keys page and the user dialog work out from a key (D-313): the
// countdown for a leaver's key, which keys are due soon, the scope as words,
// and the issue request from the form.

import type { ApiKeyView, CreateApiKeyInput } from '@galvanigraph/core-models';
import { fromDateTimeLocal } from './collections.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long before a leaver's key is disabled the banner shows (from day 5 of the 7). */
export const REPLACEMENT_WARNING_MS = 2 * DAY_MS;

/** "Disabled in 3 days unless replaced", for a key waiting on a leaver's replacement; null otherwise. */
export function replacementCountdown(key: Pick<ApiKeyView, 'replaceBy' | 'status'>, now: number): string | null {
  if (key.replaceBy === null || key.status !== 'active') return null;
  const left = Date.parse(key.replaceBy) - now;
  if (left <= 0) return 'Disabled: not replaced in time';
  if (left < DAY_MS) {
    const hours = Math.max(1, Math.ceil(left / (60 * 60 * 1000)));
    return `Disabled in ${String(hours)} ${hours === 1 ? 'hour' : 'hours'} unless replaced`;
  }
  const days = Math.ceil(left / DAY_MS);
  return `Disabled in ${String(days)} ${days === 1 ? 'day' : 'days'} unless replaced`;
}

/** The active keys whose leaver's replacement deadline is within two days. */
export function keysDueSoon(keys: readonly ApiKeyView[], now: number): readonly ApiKeyView[] {
  return keys.filter((k) => k.status === 'active' && k.replaceBy !== null && Date.parse(k.replaceBy) - now <= REPLACEMENT_WARNING_MS);
}

/** The working keys `userId` issued: what disabling them stops, and all that offboarding acts on. */
export function liveKeysIssuedBy(keys: readonly ApiKeyView[], userId: string): readonly ApiKeyView[] {
  return keys.filter((k) => k.issuedBy.id === userId && k.status === 'active');
}

/** "All channels", or the group names joined. */
export function keyScopeLabel(groupIds: readonly string[] | null, groupName: (id: string) => string): string {
  return groupIds === null ? 'All channels' : groupIds.map(groupName).join(', ');
}

/** The issue form as typed. */
export interface KeyDraft {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  /** A datetime-local value. */
  readonly expiresAt: string;
  readonly reason: string;
}

/** A key that reads every channel's messages needs a reason (D-313). */
export function needsReason(draft: Pick<KeyDraft, 'groupIds' | 'permissions'>): boolean {
  return draft.groupIds === null && draft.permissions.some((p) => p === 'messages:read');
}

/** Why the form cannot be sent yet, or null when it can. */
export function draftProblem(draft: KeyDraft, now: number): string | null {
  if (draft.name.trim() === '') return 'Name the key.';
  if (draft.permissions.length === 0) return 'Give the key at least one permission.';
  if (draft.groupIds !== null && draft.groupIds.length === 0) return 'Choose at least one group, or every channel.';
  const ends = fromDateTimeLocal(draft.expiresAt);
  if (ends === null || ends === undefined) return 'Pick when the key ends.';
  if (Date.parse(ends) <= now) return 'Pick an end time in the future.';
  if (needsReason(draft) && draft.reason.trim().length < 3) return 'Say why this key reads every channel\'s messages.';
  return null;
}

/** The request for a draft `draftProblem` passed. */
export function toIssueInput(draft: KeyDraft): CreateApiKeyInput {
  // A reason the form no longer shows (the scope or permissions changed) is not sent.
  const reason = needsReason(draft) ? draft.reason.trim() : '';
  return {
    name: draft.name.trim(),
    description: draft.description,
    permissions: [...draft.permissions] as CreateApiKeyInput['permissions'],
    groupIds: draft.groupIds === null ? null : [...draft.groupIds],
    expiresAt: fromDateTimeLocal(draft.expiresAt) ?? '',
    reason: reason === '' ? null : reason,
  };
}
