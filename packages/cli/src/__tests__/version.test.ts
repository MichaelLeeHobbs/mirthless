// ===========================================
// CLI Version Tests
// ===========================================

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('galvaniflow --version', () => {
  it('reports the version in package.json', () => {
    const pkg = JSON.parse(read('../../package.json')) as { version: string };
    expect(read('../index.ts')).toContain(`.version('${pkg.version}')`);
  });

  it('names the binary galvaniflow', () => {
    const pkg = JSON.parse(read('../../package.json')) as { bin: Record<string, string> };
    expect(Object.keys(pkg.bin)).toEqual(['galvaniflow']);
    expect(read('../index.ts')).toContain(".name('galvaniflow')");
  });
});
