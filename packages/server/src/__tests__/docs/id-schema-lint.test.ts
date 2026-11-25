// The eslint.config.js rule that reads every id with idSchema (D-348).

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function findings(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(`import { z } from 'zod/v4';\nexport const s = ${code};`, { filePath: path.join(repoRoot, file) });
  return (result?.messages ?? []).filter((m) => m.message.includes('idSchema')).length;
}

describe('the id schema lint rule', () => {
  it.each([
    'z.string().uuid()',
    "z.string().uuid('not an id')",
    'z.array(z.string().min(1).uuid())',
    'z.uuid()',
    'z.uuidv4()',
    'z.guid()',
  ])('flags %s in a route, and in a schema', async (code) => {
    expect(await findings(code, 'packages/server/src/routes/probe.routes.ts')).toBe(1);
    expect(await findings(code, 'packages/core-models/src/schemas/probe.schema.ts')).toBe(1);
  }, 30_000);

  it.each([
    'packages/web/src/pages/probe.tsx',
    'packages/connectors/src/__tests__/probe.test.ts',
    'e2e/probe.spec.ts',
  ])('applies in %s, where another rule set replaces the first', async (file) => {
    expect(await findings('z.string().uuid()', file)).toBe(1);
  }, 30_000);

  it('allows idSchema', async () => {
    expect(await findings("z.object({ id: idSchema, other: z.string().min(1) })", 'packages/server/src/routes/probe.routes.ts')).toBe(0);
  }, 30_000);
});
