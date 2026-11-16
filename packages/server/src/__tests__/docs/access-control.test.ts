// ===========================================
// Docs guard: docs/user/access-control.md
// ===========================================
// Admins decide who gets which role from this page, so its role matrix must be
// the seed's role map, cell for cell. That every permission guards some route is
// checked in routes/__tests__/route-permissions.test.ts; how each PHI or
// destructive endpoint answers each role is tested over HTTP in
// routes/__tests__/role-access.test.ts.

import { describe, it, expect } from 'vitest';
import { PERMISSIONS, USER_ROLE } from '@galvanigraph/core-models';
import { permissionNamesForRole } from '../../lib/role-permissions.js';
import { readRepoFile, tables, brokenRelativeLinks } from '../../../test/markdown.js';

const DOC = 'docs/user/access-control.md';
const ROLES = Object.values(USER_ROLE);

function matrix(): readonly (readonly string[])[] {
  const table = tables(readRepoFile(DOC)).find((t) => t.under?.text === 'Role and permission matrix');
  if (!table) throw new Error(`${DOC} has no table under "## Role and permission matrix"`);
  expect(table.header).toEqual(['Permission', ...ROLES, 'Also allows']);
  return table.rows;
}

describe('access control: role and permission matrix', () => {
  it('has one row per permission', () => {
    const names = matrix().map((row) => /^`([a-z_]+:[a-z_]+)`$/.exec(row[0] ?? '')?.[1] ?? `bad cell: ${row[0] ?? ''}`);
    expect([...names].sort()).toEqual([...Object.values(PERMISSIONS)].sort());
  });

  it('marks each role exactly as the role seed grants it', () => {
    for (const row of matrix()) {
      const permission = (row[0] ?? '').replaceAll('`', '');
      ROLES.forEach((role, i) => {
        expect(row[i + 1], `${permission} for ${role}`).toBe(permissionNamesForRole(role).includes(permission) ? 'Yes' : 'No');
      });
    }
  });
});

describe('access control: links', () => {
  it('links only to files and headings that exist', () => {
    expect(brokenRelativeLinks(DOC)).toEqual([]);
  });
});
