import { describe, it, expect } from 'vitest';
import { loadedScriptLanguage, NEW_SCRIPT_LANGUAGE, NEW_CHANNEL_SCRIPT_LANGUAGES } from '../script-language.js';

describe('loadedScriptLanguage', () => {
  it('keeps the stored language of a script that has code', () => {
    expect(loadedScriptLanguage('return true;', 'TYPESCRIPT')).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage('return true;', 'JAVASCRIPT')).toBe('JAVASCRIPT');
  });

  it('reads a script with code and no stored language as JavaScript, how it was written', () => {
    expect(loadedScriptLanguage('return true;', undefined)).toBe('JAVASCRIPT');
  });

  // #183: an empty script saved as JavaScript used to reopen as TypeScript.
  it('keeps the stored language of an empty script', () => {
    expect(loadedScriptLanguage('', 'JAVASCRIPT')).toBe('JAVASCRIPT');
    expect(loadedScriptLanguage('   \n', 'TYPESCRIPT')).toBe('TYPESCRIPT');
  });

  it('starts an empty script with no stored language as TypeScript', () => {
    expect(NEW_SCRIPT_LANGUAGE).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage(null, undefined)).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage('', null)).toBe('TYPESCRIPT');
  });
});

describe('NEW_CHANNEL_SCRIPT_LANGUAGES', () => {
  it('creates a channel with its four scripts in TypeScript', () => {
    expect(NEW_CHANNEL_SCRIPT_LANGUAGES).toEqual({
      deploy: 'TYPESCRIPT', undeploy: 'TYPESCRIPT', preprocessor: 'TYPESCRIPT', postprocessor: 'TYPESCRIPT',
    });
  });
});
