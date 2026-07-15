// ===========================================
// Sandbox ambient types ↔ Monaco defs drift guard
// ===========================================
// The engine ships the canonical ambient sandbox types (sandbox-globals.d.ts)
// for authoring TS channel scripts; the web admin carries a mirror string for
// Monaco (packages/web/src/lib/sandbox-types.ts) because web can't import engine.
// This test fails if the two declare a different set of global names, so the
// copies can't silently drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dtsPath = fileURLToPath(new URL('../../sandbox-globals.d.ts', import.meta.url));
const webPath = fileURLToPath(new URL('../../../web/src/lib/sandbox-types.ts', import.meta.url));

/** Extract the set of `declare var|function` global names from a source string. */
function declaredGlobals(source: string): Set<string> {
  const names = new Set<string>();
  const re = /declare\s+(?:var|function)\s+(\$?\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) names.add(m[1]);
  }
  return names;
}

describe('sandbox ambient types stay in sync with the Monaco defs', () => {
  it('engine .d.ts and web SANDBOX_TYPE_DEFS declare the same global names', () => {
    const engine = declaredGlobals(readFileSync(dtsPath, 'utf-8'));
    const web = declaredGlobals(readFileSync(webPath, 'utf-8'));

    expect(engine.size).toBeGreaterThan(10);
    const onlyInEngine = [...engine].filter((n) => !web.has(n)).sort();
    const onlyInWeb = [...web].filter((n) => !engine.has(n)).sort();
    expect({ onlyInEngine, onlyInWeb }).toEqual({ onlyInEngine: [], onlyInWeb: [] });
  });
});
