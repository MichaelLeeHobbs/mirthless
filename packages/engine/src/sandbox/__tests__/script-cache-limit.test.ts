// Filling the cache takes SCRIPT_CACHE_LIMIT compiles. Through real esbuild that
// took up to a minute on a loaded machine (#125), so this file stubs esbuild's
// transform (an external dependency) with one that echoes its input. The cache
// logic under test is the real code.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const transform = vi.hoisted(() => vi.fn(async (input: string) => ({ code: input, map: '' })));
vi.mock('esbuild', () => ({ transform }));

import { compileScript, clearScriptCache, scriptCacheSize, SCRIPT_CACHE_LIMIT } from '../script-compiler.js';

async function fill(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const result = await compileScript(`return ${String(i)};`, { sourcemap: false });
    if (!result.ok) throw new Error(`compile ${String(i)} failed: ${result.error.message}`);
  }
}

describe('script cache limit', () => {
  beforeEach(() => {
    clearScriptCache();
    transform.mockClear();
  });

  it('stops growing at its limit', async () => {
    await fill(SCRIPT_CACHE_LIMIT + 5);

    expect(transform).toHaveBeenCalledTimes(SCRIPT_CACHE_LIMIT + 5);
    expect(scriptCacheSize()).toBe(SCRIPT_CACHE_LIMIT);
  });

  it('keeps the newest entries and drops the oldest', async () => {
    await fill(SCRIPT_CACHE_LIMIT + 5);
    transform.mockClear();

    // The newest and the oldest survivor (script 5) come from the cache.
    await compileScript(`return ${String(SCRIPT_CACHE_LIMIT + 4)};`, { sourcemap: false });
    await compileScript('return 5;', { sourcemap: false });
    expect(transform).not.toHaveBeenCalled();

    // Script 4 was the last one dropped, so it compiles afresh and the cache stays at its limit.
    const dropped = await compileScript('return 4;', { sourcemap: false });
    expect(dropped.ok).toBe(true);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(scriptCacheSize()).toBe(SCRIPT_CACHE_LIMIT);
  });
});
