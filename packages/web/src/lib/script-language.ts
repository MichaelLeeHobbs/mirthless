// ===========================================
// Script language in the editor
// ===========================================

import { toScriptLanguage, type ScriptLanguageCode } from '@galvanigraph/core-models';

/** A script the user starts in the editor is TypeScript. */
export const NEW_SCRIPT_LANGUAGE: ScriptLanguageCode = 'TYPESCRIPT';

/** The languages new deploy, undeploy, preprocessor and postprocessor scripts start in (a channel's or the global ones). */
export const NEW_CHANNEL_SCRIPT_LANGUAGES: Readonly<Record<'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor', ScriptLanguageCode>> = {
  deploy: NEW_SCRIPT_LANGUAGE,
  undeploy: NEW_SCRIPT_LANGUAGE,
  preprocessor: NEW_SCRIPT_LANGUAGE,
  postprocessor: NEW_SCRIPT_LANGUAGE,
};

/**
 * The language to edit a saved script in: the stored one, even for an empty
 * script, so a script switched to JavaScript stays JavaScript (#183). Only an
 * empty script with no stored language starts as TypeScript; one with code and
 * no stored language was written as JavaScript.
 */
export function loadedScriptLanguage(script: string | null | undefined, stored: unknown): ScriptLanguageCode {
  if (stored === undefined || stored === null) {
    return (script ?? '').trim() === '' ? NEW_SCRIPT_LANGUAGE : toScriptLanguage(stored);
  }
  return toScriptLanguage(stored);
}
