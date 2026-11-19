// Monaco's TypeScript service holds one set of global declarations, so only the editor whose surface was applied last
// is checked against its own; this tracks which, so the others hide their type errors (#183). No Monaco import, so it can be tested.

import { scriptDeclarations, templateDeclarations, type ScriptSurface, type TemplateSource } from '@galvanigraph/core-models';

export interface SurfaceLibs {
  /** Equal keys mean equal declarations. */
  readonly key: string;
  readonly files: ReadonlyArray<{ readonly content: string; readonly filePath: string }>;
}

/** A transformer step can use earlier steps' top-level names; the editor declares them `any`, and deploy checks their real types. */
function earlierStepDeclarations(names: readonly string[], declaredElsewhere: string): string {
  // A name the sandbox or a template already declares keeps that declaration.
  const taken = new Set([...declaredElsewhere.matchAll(/\bdeclare\s+(?:const|let|var|function|class|namespace)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  return names.filter((n) => !taken.has(n)).map((n) => `declare let ${n}: any;`).join('\n');
}

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

export function appliedSurfaceKey(): string {
  return applied;
}

export function markSurfaceApplied(key: string): boolean {
  if (key === applied) return false;
  applied = key;
  for (const listener of listeners) listener();
  return true;
}

export function onSurfaceApplied(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reads only declarations at the start of a line, not destructuring or indented ones: a name it misses is flagged in the editor, and deploy checks the steps joined. */
export function topLevelNames(code: string): string[] {
  const names = new Set<string>();
  const declaration = /^(?:const|let|var|(?:async\s+)?function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of code.matchAll(declaration)) names.add(match[1]!);
  return [...names];
}

/** Deploy joins every enabled step that has a script (script-type-gate). */
export function earlierStepNames(
  steps: ReadonlyArray<{ readonly enabled: boolean; readonly script: string }>, index: number,
): string[] {
  return [...new Set(steps.slice(0, index)
    .filter((s) => s.enabled)
    .flatMap((s) => topLevelNames(s.script)))];
}
