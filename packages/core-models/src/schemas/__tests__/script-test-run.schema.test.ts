import { describe, it, expect } from 'vitest';
import { scriptTestRunSchema } from '../script-test-run.schema.js';

describe('scriptTestRunSchema', () => {
  it('accepts a filter test with a channel and defaults destinationSet to false', () => {
    const parsed = scriptTestRunSchema.parse({
      script: 'return true;', kind: 'filter', sample: 'MSH|^~\\&|', dataType: 'HL7V2',
      templateContext: 'SOURCE_FILTER_TRANSFORMER', channelId: '3f2b8c1e-4d5a-4b6c-9e7f-1a2b3c4d5e6f',
    });
    expect(parsed.destinationSet).toBe(false);
  });

  it('allows a script with no message: no data type', () => {
    expect(scriptTestRunSchema.safeParse({ script: 'x', kind: 'script', sample: '' }).success).toBe(true);
  });

  it('refuses an unknown kind, data type or template context', () => {
    expect(scriptTestRunSchema.safeParse({ script: 'x', kind: 'mapper', sample: '' }).success).toBe(false);
    expect(scriptTestRunSchema.safeParse({ script: 'x', kind: 'script', sample: '', dataType: 'CSV' }).success).toBe(false);
    expect(scriptTestRunSchema.safeParse({ script: 'x', kind: 'script', sample: '', templateContext: 'NOPE' }).success).toBe(false);
  });

  it('refuses a sample over 1 MB', () => {
    const sample = 'x'.repeat(1024 * 1024 + 1);
    expect(scriptTestRunSchema.safeParse({ script: 'x', kind: 'script', sample }).success).toBe(false);
  });
});
