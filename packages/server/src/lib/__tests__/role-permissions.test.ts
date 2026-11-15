// ===========================================
// Role → Permission Resolution Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '@galvaniflow/core-models';
import { permissionRowsForRole, permissionNamesForRole, isKnownRole, permissionRow } from '../role-permissions.js';
import { defaultPermissions } from '../../db/seeds/permissions.js';

describe('default permission seed rows', () => {
  it('has exactly one row per core-models permission', () => {
    const names = defaultPermissions.map((p) => p.name);
    expect(names).toEqual(Object.values(PERMISSIONS));
    expect(new Set(names).size).toBe(names.length);
  });

  it('splits each name into resource and action at the colon', () => {
    expect(defaultPermissions).toContainEqual({ name: 'code_templates:delete', resource: 'code_templates', action: 'delete' });
    expect(defaultPermissions).toContainEqual({ name: 'system:info', resource: 'system', action: 'info' });
    for (const p of defaultPermissions) {
      expect(`${p.resource}:${p.action}`).toBe(p.name);
      expect(p.resource.length > 0 && p.action.length > 0).toBe(true);
    }
  });
});

describe('role-permissions', () => {
  it('grants the admin every permission', () => {
    const names = permissionNamesForRole('admin');
    expect(names).toContain('users:write');
    expect(names).toContain('channels:deploy');
    expect(names).toContain('settings:write');
    expect(names.length).toBeGreaterThan(20);
    expect([...names].sort()).toEqual(Object.values(PERMISSIONS).sort());
  });

  it('grants a deployer deploy but NOT user management', () => {
    const names = permissionNamesForRole('deployer');
    expect(names).toContain('channels:deploy');
    expect(names).toContain('messages:reprocess');
    expect(names).not.toContain('users:write');
    expect(names).not.toContain('settings:write');
  });

  it('grants a developer write on channels but NOT deploy', () => {
    const names = permissionNamesForRole('developer');
    expect(names).toContain('channels:write');
    expect(names).not.toContain('channels:deploy');
    expect(names).not.toContain('users:read');
  });

  it('grants a viewer only read permissions', () => {
    const names = permissionNamesForRole('viewer');
    expect(names).toContain('channels:read');
    expect(names).toContain('messages:read');
    for (const n of names) {
      expect(n.endsWith(':read')).toBe(true);
    }
  });

  it('splits each permission into resource and action', () => {
    const rows = permissionRowsForRole('viewer');
    expect(rows).toContainEqual({ resource: 'channels', action: 'read' });
    expect(rows.every((r) => r.resource.length > 0 && r.action.length > 0)).toBe(true);
  });

  it('splits a permission name at its first colon and rejects an empty side', () => {
    expect(permissionRow('code_templates:delete')).toEqual({ resource: 'code_templates', action: 'delete' });
    expect(permissionRow('a:b:c')).toEqual({ resource: 'a', action: 'b:c' });
    expect(permissionRow('nocolon')).toBeNull();
    expect(permissionRow(':read')).toBeNull();
    expect(permissionRow('channels:')).toBeNull();
  });

  it('resolves an unknown role to no permissions (least privilege)', () => {
    expect(permissionRowsForRole('wizard')).toHaveLength(0);
    expect(permissionNamesForRole('wizard')).toHaveLength(0);
  });

  it('identifies known roles', () => {
    expect(isKnownRole('admin')).toBe(true);
    expect(isKnownRole('viewer')).toBe(true);
    expect(isKnownRole('wizard')).toBe(false);
  });
});
