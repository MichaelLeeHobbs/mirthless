// ===========================================
// Template Injector Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { prependTemplates, type CodeTemplateData } from '../template-injector.js';

// ----- Test Data -----

function makeTemplate(overrides?: Partial<CodeTemplateData>): CodeTemplateData {
  return {
    code: 'function helper() { return 42; }',
    type: 'FUNCTION',
    contexts: ['CHANNEL_PREPROCESSOR'],
    ...overrides,
  };
}

// ----- Tests -----

describe('prependTemplates', () => {
  it('returns original script when no templates match', () => {
    const script = 'return msg;';
    const templates = [makeTemplate({ contexts: ['DESTINATION_FILTER_TRANSFORMER'] })];
    expect(prependTemplates(script, templates, 'preprocessor')).toBe(script);
  });

  it('prepends FUNCTION template matching context', () => {
    const script = 'return helper();';
    const templates = [makeTemplate({ contexts: ['CHANNEL_PREPROCESSOR'] })];
    const result = prependTemplates(script, templates, 'preprocessor');
    expect(result).toContain('function helper()');
    expect(result).toContain('return helper();');
    expect(result.indexOf('function helper()')).toBeLessThan(result.indexOf('return helper();'));
  });

  it('skips CODE_BLOCK templates', () => {
    const script = 'return msg;';
    const templates = [makeTemplate({ type: 'CODE_BLOCK', contexts: ['CHANNEL_PREPROCESSOR'] })];
    expect(prependTemplates(script, templates, 'preprocessor')).toBe(script);
  });

  it('skips templates with non-matching context', () => {
    const script = 'return msg;';
    const templates = [makeTemplate({ contexts: ['GLOBAL_PREPROCESSOR'] })];
    expect(prependTemplates(script, templates, 'preprocessor')).toBe(script);
  });

  it('prepends multiple templates in order', () => {
    const script = 'return first() + second();';
    const templates = [
      makeTemplate({ code: 'function first() { return 1; }', contexts: ['CHANNEL_PREPROCESSOR'] }),
      makeTemplate({ code: 'function second() { return 2; }', contexts: ['CHANNEL_PREPROCESSOR'] }),
    ];
    const result = prependTemplates(script, templates, 'preprocessor');
    expect(result).toContain('function first()');
    expect(result).toContain('function second()');
    expect(result.indexOf('function first()')).toBeLessThan(result.indexOf('function second()'));
  });

  it('maps sourceFilter to SOURCE_FILTER_TRANSFORMER context', () => {
    const script = 'return true;';
    const templates = [makeTemplate({ contexts: ['SOURCE_FILTER_TRANSFORMER'] })];
    const result = prependTemplates(script, templates, 'sourceFilter');
    expect(result).toContain('function helper()');
  });

  it('maps sourceTransformer to SOURCE_FILTER_TRANSFORMER context', () => {
    const script = 'return tmp;';
    const templates = [makeTemplate({ contexts: ['SOURCE_FILTER_TRANSFORMER'] })];
    const result = prependTemplates(script, templates, 'sourceTransformer');
    expect(result).toContain('function helper()');
  });

  it('maps destinationFilter to DESTINATION_FILTER_TRANSFORMER context', () => {
    const script = 'return true;';
    const templates = [makeTemplate({ contexts: ['DESTINATION_FILTER_TRANSFORMER'] })];
    const result = prependTemplates(script, templates, 'destinationFilter');
    expect(result).toContain('function helper()');
  });

  it('maps globalPreprocessor to GLOBAL_PREPROCESSOR context', () => {
    const script = 'return msg;';
    const templates = [makeTemplate({ contexts: ['GLOBAL_PREPROCESSOR'] })];
    const result = prependTemplates(script, templates, 'globalPreprocessor');
    expect(result).toContain('function helper()');
  });

  it('returns original for unknown context key', () => {
    const script = 'return msg;';
    const templates = [makeTemplate()];
    expect(prependTemplates(script, templates, 'unknownContext')).toBe(script);
  });

  it('returns original when templates array is empty', () => {
    const script = 'return msg;';
    expect(prependTemplates(script, [], 'preprocessor')).toBe(script);
  });
});
