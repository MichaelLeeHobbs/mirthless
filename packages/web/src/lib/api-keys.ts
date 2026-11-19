import { ALL_CHANNELS, type ApiKeyView, type CreateApiKeyInput, type GrantEntry } from '@galvanigraph/core-models';
import { fromDateTimeLocal } from './collections.js';

/**
 * Who may take a leaver's key over (D-322). The server also checks the holder
 * keeps these grants until the key ends, which the web cannot see.
 */
export function coversKey(grants: readonly GrantEntry[] | undefined, key: Pick<ApiKeyView, 'permissions' | 'groupIds'>): boolean {
  if (grants === undefined) return false;
  return key.permissions.every((permission) => {
    const held = grants.find((g) => g.permission === permission);
    if (held === undefined) return false;
    if (held.scope === ALL_CHANNELS) return true;
    return key.groupIds !== null && key.groupIds.every((g) => (held.scope as readonly string[]).includes(g));
  });
}

export function liveKeysIssuedBy(keys: readonly ApiKeyView[], userId: string): readonly ApiKeyView[] {
  return keys.filter((k) => k.issuedBy.id === userId && k.status === 'active');
}

export function keyScopeLabel(groupIds: readonly string[] | null, groupName: (id: string) => string): string {
  return groupIds === null ? 'All channels' : groupIds.map(groupName).join(', ');
}

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
