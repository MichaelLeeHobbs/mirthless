// The ids an import gives the copies it makes of channels that are here already.

import type { ChannelExportEntry } from '@galvanigraph/core-models';

type FileDestination = ChannelExportEntry['destinations'][number];

function retargeted(dest: FileDestination, ids: ReadonlyMap<string, string>): FileDestination {
  const target = dest.properties['targetChannelId'];
  const copy = dest.connectorType === 'CHANNEL' && typeof target === 'string' ? ids.get(target.toLowerCase()) : undefined;
  return copy === undefined ? dest : { ...dest, properties: { ...dest.properties, targetChannelId: copy } };
}

/**
 * The entries under their new ids, with every Channel Writer that sends to one
 * of them sending to its copy. A copied channel's destinations get ids of their own.
 * `ids`: by the id in the file, in lower case.
 */
export function withCopies(entries: readonly ChannelExportEntry[], ids: ReadonlyMap<string, string>): readonly ChannelExportEntry[] {
  if (ids.size === 0) return entries;
  return entries.map((entry) => {
    const destinations = entry.destinations.map((d) => retargeted(d, ids));
    const id = ids.get(entry.id.toLowerCase());
    return id === undefined ? { ...entry, destinations } : { ...entry, id, destinations: destinations.map(({ id: _id, ...d }) => d) };
  });
}
