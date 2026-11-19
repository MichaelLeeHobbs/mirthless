// D-310: a creator holding channels:write on several groups must name one, or
// the server answers 400. On every channel or one group, the server uses
// Default or that group.

import { ALL_CHANNELS } from '@galvanigraph/core-models';
import { useAuthStore } from '../stores/auth.store.js';
import { useChannelGroups, type ChannelGroupSummary } from './use-channel-groups.js';

/** null when the creator needs no choice. */
export function writeGroupChoices(grants: ReadonlyArray<{ readonly permission: string; readonly scope: unknown }> | undefined): readonly string[] | null {
  const entry = grants?.find((g) => g.permission === 'channels:write');
  if (!entry || entry.scope === ALL_CHANNELS || !Array.isArray(entry.scope)) return null;
  const ids = entry.scope.filter((id): id is string => typeof id === 'string');
  return ids.length > 1 ? ids : null;
}

/** null when no choice is needed. A group the list cannot name shows by its id. */
export function useNewChannelGroups(): readonly Pick<ChannelGroupSummary, 'id' | 'name'>[] | null {
  const grants = useAuthStore((s) => s.user?.grants);
  const { data: groups } = useChannelGroups();
  const ids = writeGroupChoices(grants);
  if (ids === null) return null;
  return ids.map((id) => ({ id, name: groups?.find((g) => g.id === id)?.name ?? id }));
}
