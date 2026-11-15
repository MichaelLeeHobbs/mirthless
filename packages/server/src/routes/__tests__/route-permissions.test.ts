// ===========================================
// Route Permission Coverage Test
// ===========================================
// A permission the seed grants but no route checks gives a false sense of
// access control (see code_templates:delete, issue #96). This scans the route
// sources for the permissions they check and fails on any seeded permission
// that none of them uses.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '@galvaniflow/core-models';

const routesDir = fileURLToPath(new URL('..', import.meta.url));
const appFile = fileURLToPath(new URL('../../app.ts', import.meta.url));

function checkedPermissions(): ReadonlySet<string> {
  const files = readdirSync(routesDir)
    .filter((name) => name.endsWith('.routes.ts'))
    .map((name) => join(routesDir, name));
  const found = new Set<string>();
  const call = /require(?:All)?Permissions?\(([^)]*)\)/g;
  for (const file of [...files, appFile]) {
    for (const match of readFileSync(file, 'utf8').matchAll(call)) {
      for (const literal of (match[1] ?? '').matchAll(/'([^']+)'/g)) {
        if (literal[1] !== undefined) found.add(literal[1]);
      }
    }
  }
  return found;
}

describe('route permissions', () => {
  it('checks every seeded permission on at least one route', () => {
    const checked = checkedPermissions();
    const unchecked = Object.values(PERMISSIONS).filter((p) => !checked.has(p));
    expect(unchecked).toEqual([]);
  });
});
