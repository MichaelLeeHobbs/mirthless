// UI gating only: the server enforces authorization on every request.

import { useMemo } from 'react';
import { holdsPermission } from '@galvanigraph/core-models';
import { useAuthStore } from '../stores/auth.store.js';
import type { PermissionString } from '../lib/permissions.js';

export interface PermissionApi {
  readonly permissions: ReadonlySet<string>;
  readonly has: (permission: PermissionString) => boolean;
  readonly hasAny: (permissions: readonly PermissionString[]) => boolean;
  readonly hasAll: (permissions: readonly PermissionString[]) => boolean;
}

export function usePermissions(): PermissionApi {
  const user = useAuthStore((state) => state.user);

  return useMemo((): PermissionApi => {
    const held = user?.permissions;
    const has = (permission: PermissionString): boolean => holdsPermission(held, permission);
    return {
      permissions: new Set<string>(held ?? []),
      has,
      hasAny: (perms): boolean => perms.some(has),
      hasAll: (perms): boolean => perms.every(has),
    };
  }, [user]);
}
