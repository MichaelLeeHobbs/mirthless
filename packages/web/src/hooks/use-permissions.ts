// ===========================================
// usePermissions
// ===========================================
// Reads the authenticated user's permissions from the auth store and exposes
// helpers for gating UI controls. UI gating is a UX convenience — the server
// still enforces authorization on every request.

import { useMemo } from 'react';
import { useAuthStore } from '../stores/auth.store.js';
import type { PermissionString } from '../lib/permissions.js';

export interface PermissionApi {
  /** All permission strings granted to the current user. */
  readonly permissions: ReadonlySet<string>;
  /** True if the user has the given permission. */
  readonly has: (permission: PermissionString) => boolean;
  /** True if the user has at least one of the given permissions. */
  readonly hasAny: (permissions: readonly PermissionString[]) => boolean;
  /** True if the user has all of the given permissions. */
  readonly hasAll: (permissions: readonly PermissionString[]) => boolean;
}

export function usePermissions(): PermissionApi {
  const user = useAuthStore((state) => state.user);

  return useMemo((): PermissionApi => {
    const set = new Set<string>(user?.permissions ?? []);
    const has = (permission: PermissionString): boolean => set.has(permission);
    return {
      permissions: set,
      has,
      hasAny: (perms): boolean => perms.some((p) => set.has(p)),
      hasAll: (perms): boolean => perms.every((p) => set.has(p)),
    };
  }, [user]);
}
