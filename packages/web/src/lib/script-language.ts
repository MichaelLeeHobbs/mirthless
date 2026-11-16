// ===========================================
// Script language in the editor
// ===========================================

import { toScriptLanguage, type ScriptLanguageCode } from '@galvaniflow/core-models';

/** A script the user starts in the editor is TypeScript. */
export const NEW_SCRIPT_LANGUAGE: ScriptLanguageCode = 'TYPESCRIPT';

/**
 * The language to edit a saved script in. An empty script has nothing written
 * yet, so it starts as TypeScript whatever was stored (rows from before
 * languages existed say JavaScript); a script with code keeps its language.
 */
export function loadedScriptLanguage(script: string | null | undefined, stored: unknown): ScriptLanguageCode {
  return (script ?? '').trim() === '' ? NEW_SCRIPT_LANGUAGE : toScriptLanguage(stored);
}
