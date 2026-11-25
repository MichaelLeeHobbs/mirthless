import { PERMISSION_CATALOG, type AccessPath, type ChannelAccessView, type Permission } from '@galvanigraph/core-models';
import { escapeCsvField } from '@galvanigraph/core-util';

/** Falls back to the name for a permission this build does not know. */
export function permissionLabel(p: string): string {
  return Object.hasOwn(PERMISSION_CATALOG, p) ? PERMISSION_CATALOG[p as Permission].label : p;
}

/** A group the reader cannot see, or that is not loaded yet, shows as its id. */
export function groupNamer(groups: ReadonlyArray<{ readonly id: string; readonly name: string }> | undefined): (id: string) => string {
  return (id) => groups?.find((g) => g.id === id)?.name ?? id;
}

export function describePath(path: AccessPath, groupName: (id: string) => string, time: (iso: string) => string): string {
  const scope = path.groupIds === null ? 'All channels' : path.groupIds.map(groupName).join(', ');
  return [path.role, scope, ...(path.expiresAt ? [`until ${time(path.expiresAt)}`] : [])].join(' · ');
}

export function accessCsv(view: ChannelAccessView, groupName: (id: string) => string, now: string): string {
  // Every row carries the time it describes, so a row copied out of the file still says when.
  const at = view.asOf ?? now;
  const rows: string[][] = [['As of', 'Person', 'Access', 'Permissions', 'Role', 'Scope', 'Until']];
  for (const p of view.people) {
    for (const path of p.through) {
      const scope = path.groupIds === null ? 'All channels' : path.groupIds.map(groupName).join('; ');
      // Each row's permissions are that assignment's own, not the person's merged set.
      rows.push([at, p.username, 'Assignment', path.permissions.map(permissionLabel).join('; '), path.role, scope, path.expiresAt ?? '']);
    }
  }
  for (const p of view.throughCode) rows.push([at, p.username, 'Channel code (not recorded)', '', '', 'Every channel', '']);
  for (const p of view.throughSharedData) rows.push([at, p.username, 'Shared data and logs', '', '', 'Every channel', '']);
  return `${rows.map((r) => r.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}
