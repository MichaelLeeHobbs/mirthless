// ===========================================
// Applied script surface
// ===========================================
// Monaco's TypeScript service holds one set of global declarations for every
// editor, so only the editor whose surface was applied last (the focused one)
// is type-checked against its own declarations. This module tracks which
// surface that is, so an editor with another surface can hide the type errors
// it was given and say it is checked when focused (#183). No Monaco import, so
// it can be tested.

import { scriptDeclarations, templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvanigraph/core-models';

/** The extra declaration files for one surface. */
export interface SurfaceLibs {
  /** Identifies the declarations; two editors with the same key are checked alike. */
  readonly key: string;
  readonly files: ReadonlyArray<{ readonly content: string; readonly filePath: string }>;
}

/**
 * A transformer step runs joined with the enabled steps before it, so it can
 * use their top-level names. The editor declares those names as `any`; deploy
 * checks the joined steps with their real types.
 */
function earlierStepDeclarations(names: readonly string[], declaredElsewhere: string): string {
  // A name the sandbox or a template already declares keeps that declaration.
  const taken = new Set([...declaredElsewhere.matchAll(/\bdeclare\s+(?:const|let|var|function|class|namespace)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  return names.filter((n) => !taken.has(n)).map((n) => `declare let ${n}: any;`).join('\n');
}

/** The declaration files for a script surface, its code templates and the names of earlier steps. */
export function surfaceLibs(surface: ScriptSurface, templates: readonly TemplateSource[], earlierNames: readonly string[] = []): SurfaceLibs {
  const sandbox = scriptDeclarations(surface);
  const library = templateDeclarations(templates, surface);
  const earlier = earlierStepDeclarations(earlierNames, `${sandbox}\n${library}`);
  return {
    key: `${sandbox}\u0000${library}\u0000${earlier}`,
    files: [
      { content: sandbox, filePath: 'file:///sandbox.d.ts' },
      { content: library, filePath: 'file:///code-templates.d.ts' },
      { content: earlier, filePath: 'file:///earlier-steps.d.ts' },
    ],
  };
}

let applied = '';
const listeners = new Set<() => void>();

/** The key of the surface the TypeScript service has now. */
export function appliedSurfaceKey(): string {
  return applied;
}

/** Record that `key` is now applied. Returns false when it already was. */
export function markSurfaceApplied(key: string): boolean {
  if (key === applied) return false;
  applied = key;
  for (const listener of listeners) listener();
  return true;
}

/** Call `listener` whenever another surface is applied; returns the unsubscribe. */
export function onSurfaceApplied(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Top-level names a step declares (`const`, `let`, `var`, `function`, `class`
 * at the start of a line), for the steps after it. Destructuring and
 * declarations indented inside blocks are not read, so a name the scan misses
 * is flagged in the editor as before; deploy checks the steps joined.
 */
export function topLevelNames(code: string): string[] {
  const names = new Set<string>();
  const declaration = /^(?:const|let|var|(?:async\s+)?function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of code.matchAll(declaration)) names.add(match[1]!);
  return [...names];
}

/**
 * The names the steps before `index` declare, which the step at `index` can
 * use: deploy joins every enabled step that has a script (script-type-gate).
 */
export function earlierStepNames(
  steps: ReadonlyArray<{ readonly enabled: boolean; readonly script: string }>, index: number,
): string[] {
  return [...new Set(steps.slice(0, index)
    .filter((s) => s.enabled)
    .flatMap((s) => topLevelNames(s.script)))];
}
