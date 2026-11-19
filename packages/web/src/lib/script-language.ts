import { toScriptLanguage, type ScriptLanguageCode } from '@galvanigraph/core-models';

export const NEW_SCRIPT_LANGUAGE: ScriptLanguageCode = 'TYPESCRIPT';

export const NEW_CHANNEL_SCRIPT_LANGUAGES: Readonly<Record<'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor', ScriptLanguageCode>> = {
  deploy: NEW_SCRIPT_LANGUAGE,
  undeploy: NEW_SCRIPT_LANGUAGE,
  preprocessor: NEW_SCRIPT_LANGUAGE,
  postprocessor: NEW_SCRIPT_LANGUAGE,
};

/** The stored language wins even for an empty script (#183). With none stored, a script with code was written as JavaScript. */
export function loadedScriptLanguage(script: string | null | undefined, stored: unknown): ScriptLanguageCode {
  if (stored === undefined || stored === null) {
    return (script ?? '').trim() === '' ? NEW_SCRIPT_LANGUAGE : toScriptLanguage(stored);
  }
  return toScriptLanguage(stored);
}
