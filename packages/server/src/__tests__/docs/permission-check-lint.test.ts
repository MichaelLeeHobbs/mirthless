// ===========================================
// Lint: one permission check
// ===========================================
// eslint.config.js sends every permission check through holdsPermission or
// can (core-models authz, D-310). This proves the rule fires on the forms a
// caller writes and leaves the shared helper's own callers alone.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const eslint = new ESLint({ cwd: repoRoot });
const FILE = path.join(repoRoot, 'packages/server/src/probe.ts');

async function permissionFindings(code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: FILE });
  return (result?.messages ?? []).filter((m) => m.message.includes('holdsPermission')).length;
}

describe('the permission-check lint rule', () => {
  it.each([
    ['a member list', "export const f = (u: { permissions: string[] }): boolean => u.permissions.includes('x');"],
    ['an optional member list', "export const f = (u?: { permissions: string[] }): boolean => u?.permissions.includes('x') ?? false;"],
    ['a bare list', "export const f = (permissions: string[]): boolean => permissions.includes('x');"],
    ['indexOf', "export const f = (u: { permissions: string[] }): boolean => u.permissions.indexOf('x') >= 0;"],
    ['a bare set', "export const f = (permissions: Set<string>): boolean => permissions.has('x');"],
  ])('flags %s', async (_name, code) => {
    expect(await permissionFindings(code)).toBe(1);
  }, 30_000);

  it('allows holdsPermission', async () => {
    const code = "import { holdsPermission } from '@galvanigraph/core-models';\nexport const f = (u: { permissions: string[] }): boolean => holdsPermission(u.permissions, 'channels:read');";
    expect(await permissionFindings(code)).toBe(0);
  }, 30_000);
});
