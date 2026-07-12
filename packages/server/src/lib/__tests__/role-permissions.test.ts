// ===========================================
// Role → Permission Resolution Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { permissionRowsForRole, permissionNamesForRole, isKnownRole } from '../role-permissions.js';

describe('role-permissions', () => {
  it('grants the admin every permission', () => {
    const names = permissionNamesForRole('admin');
    expect(names).toContain('users:write');
    expect(names).toContain('channels:deploy');
    expect(names).toContain('settings:write');
    expect(names.length).toBeGreaterThan(20);
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
