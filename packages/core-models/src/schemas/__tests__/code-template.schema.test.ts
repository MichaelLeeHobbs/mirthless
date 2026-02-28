// ===========================================
// Code Template Schema Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  createCodeTemplateLibrarySchema,
  updateCodeTemplateLibrarySchema,
  createCodeTemplateSchema,
  updateCodeTemplateSchema,
  codeTemplateListQuerySchema,
  codeTemplateUuidParamSchema,
} from '../code-template.schema.js';

describe('createCodeTemplateLibrarySchema', () => {
  it('accepts valid library input', () => {
    const result = createCodeTemplateLibrarySchema.safeParse({
      name: 'My Library',
      description: 'Shared helpers',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('My Library');
    expect(result.data.description).toBe('Shared helpers');
  });

  it('defaults description to empty string', () => {
    const result = createCodeTemplateLibrarySchema.safeParse({ name: 'Lib' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBe('');
  });

  it('rejects empty name', () => {
    const result = createCodeTemplateLibrarySchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = createCodeTemplateLibrarySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateCodeTemplateLibrarySchema', () => {
  it('accepts valid update with revision', () => {
    const result = updateCodeTemplateLibrarySchema.safeParse({
      name: 'Updated Name',
      revision: 1,
    });
    expect(result.success).toBe(true);
  });

  it('requires revision', () => {
    const result = updateCodeTemplateLibrarySchema.safeParse({ name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive revision', () => {
    const result = updateCodeTemplateLibrarySchema.safeParse({ revision: 0 });
    expect(result.success).toBe(false);
  });
});

describe('createCodeTemplateSchema', () => {
  it('accepts valid template input', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'myHelper',
      type: 'FUNCTION',
      code: 'function myHelper() { return true; }',
      contexts: ['SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('myHelper');
    expect(result.data.type).toBe('FUNCTION');
    expect(result.data.contexts).toHaveLength(2);
  });

  it('accepts CODE_BLOCK type', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'snippet',
      type: 'CODE_BLOCK',
      code: 'logger.info("hello");',
      contexts: [],
    });
    expect(result.success).toBe(true);
  });

  it('defaults code to empty string', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'tmpl',
      type: 'FUNCTION',
      contexts: ['GLOBAL_DEPLOY'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.code).toBe('');
  });

  it('rejects invalid type', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'tmpl',
      type: 'INVALID',
      contexts: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid context', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'tmpl',
      type: 'FUNCTION',
      contexts: ['NOT_A_REAL_CONTEXT'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID libraryId', () => {
    const result = createCodeTemplateSchema.safeParse({
      libraryId: 'not-a-uuid',
      name: 'tmpl',
      type: 'FUNCTION',
      contexts: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateCodeTemplateSchema', () => {
  it('accepts partial update with revision', () => {
    const result = updateCodeTemplateSchema.safeParse({
      code: 'return 42;',
      revision: 2,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.code).toBe('return 42;');
    expect(result.data.revision).toBe(2);
  });

  it('requires revision', () => {
    const result = updateCodeTemplateSchema.safeParse({ name: 'updated' });
    expect(result.success).toBe(false);
  });

  it('accepts updating contexts', () => {
    const result = updateCodeTemplateSchema.safeParse({
      contexts: ['GLOBAL_PREPROCESSOR', 'CHANNEL_DEPLOY'],
      revision: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('codeTemplateListQuerySchema', () => {
  it('accepts empty query (no filter)', () => {
    const result = codeTemplateListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts libraryId filter', () => {
    const result = codeTemplateListQuerySchema.safeParse({
      libraryId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid libraryId', () => {
    const result = codeTemplateListQuerySchema.safeParse({
      libraryId: 'not-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('codeTemplateUuidParamSchema', () => {
  it('accepts valid UUID', () => {
    const result = codeTemplateUuidParamSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = codeTemplateUuidParamSchema.safeParse({ id: 'abc' });
    expect(result.success).toBe(false);
  });
});
