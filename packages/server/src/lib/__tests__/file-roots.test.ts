// ===========================================
// Server File roots (GHSA-r434-hwqg-cvcw)
// ===========================================
// Whatever FILE_CONNECTOR_ROOTS says, a File connector may not use the
// server's install (its code and .env) or its working directory.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWithinRoots } from '@galvanigraph/connectors';
import { INSTALL_ROOT, buildFileRoots } from '../file-roots.js';

describe('buildFileRoots', () => {
  it('finds the install root: the folder holding the workspace and the server package', () => {
    expect(fs.existsSync(path.join(INSTALL_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(INSTALL_ROOT, 'packages', 'server', 'package.json'))).toBe(true);
  });

  it('keeps the operator roots and denies the install root and working directory', () => {
    const roots = buildFileRoots(['/srv/files']);
    expect(roots.allowed).toEqual(['/srv/files']);
    expect(roots.denied).toEqual([INSTALL_ROOT, process.cwd()]);
  });

  it('refuses the server .env even when FILE_CONNECTOR_ROOTS allows the whole disk', async () => {
    const roots = buildFileRoots([path.parse(INSTALL_ROOT).root]);
    await expect(resolveWithinRoots(path.join(INSTALL_ROOT, '.env'), roots)).rejects.toThrow(/server's own/);
    await expect(resolveWithinRoots(path.join(INSTALL_ROOT, 'packages', 'server', 'dist'), roots)).rejects.toThrow(/server's own/);
  });
});
