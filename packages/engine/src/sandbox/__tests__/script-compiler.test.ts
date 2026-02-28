// ===========================================
// Script Compiler Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { compileScript, clearScriptCache } from '../script-compiler.js';

beforeEach(() => {
  clearScriptCache();
});

describe('compileScript', () => {
  it('compiles valid TypeScript to JavaScript', async () => {
    const result = await compileScript('const x: number = 42; return x;');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('const x = 42');
    expect(result.value.code).not.toContain(': number');
  });

  it('strips type annotations from interfaces', async () => {
    const code = `
      interface Msg { field: string; }
      const m: Msg = { field: "hello" };
      return m.field;
    `;
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('interface');
  });

  it('returns inline source map when sourcemap enabled', async () => {
    const result = await compileScript('const x = 1;', { sourcemap: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('sourceMappingURL');
  });

  it('omits source map when sourcemap disabled', async () => {
    const result = await compileScript('const x = 1;', { sourcemap: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('sourceMappingURL');
  });

  it('returns error for invalid TypeScript', async () => {
    // esbuild is lenient with TS errors but fails on syntax errors
    const result = await compileScript('const x: = ;');

    expect(result.ok).toBe(false);
  });

  it('caches compiled results for identical source', async () => {
    const code = 'const y: string = "cached";';
    const result1 = await compileScript(code);
    const result2 = await compileScript(code);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    // Same reference from cache
    expect(result1.value).toBe(result2.value);
  });

  it('handles arrow functions and modern syntax', async () => {
    const code = 'const fn = (x: number): number => x * 2; return fn(21);';
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toContain('=>');
  });

  it('handles as const assertions', async () => {
    const code = 'const vals = ["a", "b"] as const; return vals[0];';
    const result = await compileScript(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).not.toContain('as const');
  });

  it('uses custom sourcefile name in source map', async () => {
    const result = await compileScript('return 1;', {
      sourcefile: 'channel-filter.ts',
      sourcemap: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Source file name is embedded in the base64-encoded inline source map
    const match = result.value.code.match(/sourceMappingURL=data:[^,]+,(.+)/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1]!, 'base64').toString('utf-8');
    expect(decoded).toContain('channel-filter.ts');
  });

  it('clearScriptCache empties the cache', async () => {
    const code = 'const z = 1;';
    const result1 = await compileScript(code);
    clearScriptCache();
    const result2 = await compileScript(code);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    // After clearing, should be a new object
    expect(result1.value).not.toBe(result2.value);
    // But same content
    expect(result1.value.code).toBe(result2.value.code);
  });
});
