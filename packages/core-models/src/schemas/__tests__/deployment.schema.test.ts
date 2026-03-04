// ===========================================
// Deployment Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { sendMessageInputSchema } from '../deployment.schema.js';

describe('sendMessageInputSchema', () => {
  it('accepts valid message content', () => {
    const result = sendMessageInputSchema.safeParse({ content: 'MSH|^~\\&|...' });
    expect(result.success).toBe(true);
  });

  it('rejects empty content string', () => {
    const result = sendMessageInputSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing content field', () => {
    const result = sendMessageInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string content', () => {
    const result = sendMessageInputSchema.safeParse({ content: 123 });
    expect(result.success).toBe(false);
  });

  it('accepts content with whitespace (not trimmed)', () => {
    const result = sendMessageInputSchema.safeParse({ content: '  spaces  ' });
    expect(result.success).toBe(true);
  });
});
