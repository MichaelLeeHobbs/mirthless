// ===========================================
// New channel groups
// ===========================================
// A new channel joins a group inside its creator's channels:write scope
// (D-310). Someone who holds it on every channel, or on one group, needs no
// choice: the server uses Default or that group. Someone who holds it on
// several groups must name one, or the server answers 400.

import { ALL_CHANNELS } from '@galvanigraph/core-models';
import { useAuthStore } from '../stores/auth.store.js';
import { useChannelGroups, type ChannelGroupSummary } from './use-channel-groups.js';

/** The group ids a new channel may join, or null when the creator needs no choice. */
export function writeGroupChoices(grants: ReadonlyArray<{ readonly permission: string; readonly scope: unknown }> | undefined): readonly string[] | null {
  const entry = grants?.find((g) => g.permission === 'channels:write');
  if (!entry || entry.scope === ALL_CHANNELS || !Array.isArray(entry.scope)) return null;
  const ids = entry.scope.filter((id): id is string => typeof id === 'string');
  return ids.length > 1 ? ids : null;
}

/**
 * The groups the creator chooses among for a new channel, or null when no
 * choice is needed. A group the list cannot name shows by its id.
 */
export function useNewChannelGroups(): readonly Pick<ChannelGroupSummary, 'id' | 'name'>[] | null {
  const grants = useAuthStore((s) => s.user?.grants);
  const { data: groups } = useChannelGroups();
  const ids = writeGroupChoices(grants);
  if (ids === null) return null;
  return ids.map((id) => ({ id, name: groups?.find((g) => g.id === id)?.name ?? id }));
}
