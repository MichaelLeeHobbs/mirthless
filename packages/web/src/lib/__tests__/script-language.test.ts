import { describe, it, expect } from 'vitest';
import { loadedScriptLanguage, NEW_SCRIPT_LANGUAGE } from '../script-language.js';

describe('loadedScriptLanguage', () => {
  it('keeps the stored language of a script that has code', () => {
    expect(loadedScriptLanguage('return true;', 'TYPESCRIPT')).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage('return true;', 'JAVASCRIPT')).toBe('JAVASCRIPT');
  });

  it('reads a script with code and no stored language as JavaScript, how it was written', () => {
    expect(loadedScriptLanguage('return true;', undefined)).toBe('JAVASCRIPT');
  });

  it('starts an empty script as TypeScript, whatever was stored', () => {
    expect(NEW_SCRIPT_LANGUAGE).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage('', 'JAVASCRIPT')).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage('   \n', 'JAVASCRIPT')).toBe('TYPESCRIPT');
    expect(loadedScriptLanguage(null, undefined)).toBe('TYPESCRIPT');
  });
});
