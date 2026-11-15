// ===========================================
// Route Permission Coverage Test
// ===========================================
// A permission the seed grants but no route checks gives a false sense of
// access control (see code_templates:delete, issue #96). This scans the route
// sources for the permissions they check and fails on any seeded permission
// that none of them uses. The reverse also fails: a route checking a name no
// role can hold (a typo) would refuse every caller, admins included.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '@galvaniflow/core-models';

const routesDir = fileURLToPath(new URL('..', import.meta.url));
const appFile = fileURLToPath(new URL('../../app.ts', import.meta.url));

/** The argument text of every requirePermission/requireAllPermissions call in the route files and app.ts. */
function permissionCallArgs(): readonly string[] {
  const files = readdirSync(routesDir)
    .filter((name) => name.endsWith('.routes.ts'))
    .map((name) => join(routesDir, name));
  const call = /require(?:All)?Permissions?\(([^)]*)\)/g;
  return [...files, appFile].flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(call)].map((match) => match[1] ?? ''));
}

function literals(args: string): readonly string[] {
  return [...args.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('route permissions', () => {
  it('checks every seeded permission on at least one route', () => {
    const checked = new Set(permissionCallArgs().flatMap(literals));
    const unchecked = Object.values(PERMISSIONS).filter((p) => !checked.has(p));
    expect(unchecked).toEqual([]);
  });

  it('checks only permissions that exist', () => {
    const known = new Set<string>(Object.values(PERMISSIONS));
    const unknown = permissionCallArgs().flatMap(literals).filter((p) => !known.has(p));
    expect(unknown).toEqual([]);
  });

  it('names every permission as a string literal, so the checks above see it', () => {
    const notLiteral = permissionCallArgs().filter((args) => args.replace(/'[^']+'/g, '').replace(/[\s,]/g, '') !== '');
    expect(notLiteral).toEqual([]);
  });
});
