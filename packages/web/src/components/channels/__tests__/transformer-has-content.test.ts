// ===========================================
// transformerHasContent Tests
// ===========================================
// The editor omits empty transformers on save. A zero-step HL7V2→HL7V2
// transformer that still carries properties or templates must be kept.

import { describe, it, expect } from 'vitest';
import { createDefaultTransformer, createDefaultTransformerStep, transformerHasContent } from '../source/types.js';

describe('transformerHasContent', () => {
  it('is false for the default empty HL7V2 transformer', () => {
    expect(transformerHasContent(createDefaultTransformer())).toBe(false);
  });

  it('is true when there are steps', () => {
    expect(transformerHasContent({ ...createDefaultTransformer(), steps: [createDefaultTransformerStep()] })).toBe(true);
  });

  it('is true when a data type differs from HL7V2', () => {
    expect(transformerHasContent({ ...createDefaultTransformer(), inboundDataType: 'XML' })).toBe(true);
    expect(transformerHasContent({ ...createDefaultTransformer(), outboundDataType: 'JSON' })).toBe(true);
  });

  it('is true for a zero-step HL7V2 transformer with data-type properties', () => {
    expect(transformerHasContent({ ...createDefaultTransformer(), inboundProperties: { segmentDelimiter: '\\n' } })).toBe(true);
    expect(transformerHasContent({ ...createDefaultTransformer(), outboundProperties: { escape: false } })).toBe(true);
  });

  it('is true for a zero-step HL7V2 transformer with a template', () => {
    expect(transformerHasContent({ ...createDefaultTransformer(), inboundTemplate: 'MSH|^~\\&|' })).toBe(true);
    expect(transformerHasContent({ ...createDefaultTransformer(), outboundTemplate: '' })).toBe(true);
  });
});
