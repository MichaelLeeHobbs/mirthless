// The engine compiles every script with esbuild's TypeScript loader either way;
// the language decides how the editor checks it and whether deploy type-checks
// it (TypeScript only).

import { z } from 'zod/v4';

export const SCRIPT_LANGUAGES = ['JAVASCRIPT', 'TYPESCRIPT'] as const;

export const scriptLanguageSchema = z.enum(SCRIPT_LANGUAGES);

export type ScriptLanguageCode = (typeof SCRIPT_LANGUAGES)[number];

/**
 * Scripts saved before languages were stored were all edited as JavaScript, so
 * missing means JavaScript; the editor starts new scripts in TypeScript explicitly.
 */
export const DEFAULT_STORED_SCRIPT_LANGUAGE: ScriptLanguageCode = 'JAVASCRIPT';

export function toScriptLanguage(value: unknown): ScriptLanguageCode {
  return value === 'TYPESCRIPT' ? 'TYPESCRIPT' : DEFAULT_STORED_SCRIPT_LANGUAGE;
}
