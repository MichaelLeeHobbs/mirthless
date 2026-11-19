import { PERMISSION_CATALOG, allChannelsOnly, type Permission } from '@galvanigraph/core-models';

export const ROLE_FLAG = {
  ADMIN_EQUIVALENT: 'As strong as admin',
  RUNS_CODE: 'Runs code',
  READS_PHI: 'Reads PHI',
  ALL_CHANNELS_ONLY: 'All channels only',
} as const;
export type RoleFlag = (typeof ROLE_FLAG)[keyof typeof ROLE_FLAG];

const ORDER: readonly RoleFlag[] = [ROLE_FLAG.ADMIN_EQUIVALENT, ROLE_FLAG.RUNS_CODE, ROLE_FLAG.READS_PHI, ROLE_FLAG.ALL_CHANNELS_ONLY];

function isKnown(name: string): name is Permission {
  return Object.hasOwn(PERMISSION_CATALOG, name);
}

/** The admin role needs no badge beyond the admin one. */
export function roleFlags(permissions: readonly string[], opts: { readonly admin?: boolean } = {}): readonly RoleFlag[] {
  if (opts.admin === true) return [ROLE_FLAG.ADMIN_EQUIVALENT];
  const flags = new Set<RoleFlag>();
  for (const name of permissions) {
    if (!isKnown(name)) continue;
    const info = PERMISSION_CATALOG[name];
    if (info.adminEquivalent) flags.add(ROLE_FLAG.ADMIN_EQUIVALENT);
    if (info.runsCode) flags.add(ROLE_FLAG.RUNS_CODE);
    if (info.readsPhi) flags.add(ROLE_FLAG.READS_PHI);
    if (allChannelsOnly(name)) flags.add(ROLE_FLAG.ALL_CHANNELS_ONLY);
  }
  return ORDER.filter((f) => flags.has(f));
}

export function permissionFlags(permission: Permission): readonly RoleFlag[] {
  return roleFlags([permission]);
}
