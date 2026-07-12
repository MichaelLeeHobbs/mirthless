// ===========================================
// Message Reprocess / Resend Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  bulkReprocessInputSchema,
  resendParamsSchema,
} from '../message-reprocess.schema.js';
import { messageSearchQuerySchema } from '../message.schema.js';

describe('bulkReprocessInputSchema', () => {
  it('accepts a valid array of message ids', () => {
    const result = bulkReprocessInputSchema.safeParse({ messageIds: [1, 2, 3] });
    expect(result.success).toBe(true);
  });

  it('rejects an empty array', () => {
    const result = bulkReprocessInputSchema.safeParse({ messageIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 500 ids', () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const result = bulkReprocessInputSchema.safeParse({ messageIds: ids });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 500 ids', () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const result = bulkReprocessInputSchema.safeParse({ messageIds: ids });
    expect(result.success).toBe(true);
  });

  it('rejects non-positive ids', () => {
    const result = bulkReprocessInputSchema.safeParse({ messageIds: [0] });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer ids', () => {
    const result = bulkReprocessInputSchema.safeParse({ messageIds: [1.5] });
    expect(result.success).toBe(false);
  });
});

describe('resendParamsSchema', () => {
  it('accepts a valid uuid, msgId, and metaDataId', () => {
    const result = resendParamsSchema.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      msgId: '42',
      metaDataId: '1',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.msgId).toBe(42);
    expect(result.data.metaDataId).toBe(1);
  });

  it('accepts metaDataId of 0 (source connector)', () => {
    const result = resendParamsSchema.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      msgId: '1',
      metaDataId: '0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid channel id', () => {
    const result = resendParamsSchema.safeParse({ id: 'not-a-uuid', msgId: '1', metaDataId: '1' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative metaDataId', () => {
    const result = resendParamsSchema.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      msgId: '1',
      metaDataId: '-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('messageSearchQuerySchema messageId filter', () => {
  it('coerces a messageId string to a positive integer', () => {
    const result = messageSearchQuerySchema.safeParse({ messageId: '99' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.messageId).toBe(99);
  });

  it('leaves messageId undefined when omitted', () => {
    const result = messageSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.messageId).toBeUndefined();
  });

  it('rejects a non-positive messageId', () => {
    const result = messageSearchQuerySchema.safeParse({ messageId: '0' });
    expect(result.success).toBe(false);
  });
});
