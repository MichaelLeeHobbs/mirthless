// ===========================================
// Message Export Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { messageExportQuerySchema } from '../message-export.schema.js';

describe('messageExportQuerySchema', () => {
  it('defaults format to csv, limit to 10000, includeContent to false', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.format).toBe('csv');
    expect(result.data.limit).toBe(10_000);
    expect(result.data.includeContent).toBe(false);
  });

  it('accepts json format', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', format: 'json' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.format).toBe('json');
  });

  it('rejects an unknown format', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', format: 'xml' });
    expect(result.success).toBe(false);
  });

  it('normalizes a single status value to an array', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', status: 'ERROR' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toEqual(['ERROR']);
  });

  it('accepts an array of statuses', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', status: ['SENT', 'ERROR'] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toEqual(['SENT', 'ERROR']);
  });

  it('does NOT coerce the string "false" to true for includeContent', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', includeContent: 'false' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeContent).toBe(false);
  });

  it('parses the string "true" as includeContent true', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', includeContent: 'true' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeContent).toBe(true);
  });

  it('coerces date strings for startDate and endDate', () => {
    const result = messageExportQuerySchema.safeParse({
      reason: 'Review',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T23:59:59.999Z',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.startDate).toBeInstanceOf(Date);
    expect(result.data.endDate).toBeInstanceOf(Date);
  });

  it('rejects a limit above the 10000 cap', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', limit: 10_001 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive limit', () => {
    const result = messageExportQuerySchema.safeParse({ reason: 'Review', limit: 0 });
    expect(result.success).toBe(false);
  });

  it('requires a reason of 3 to 500 characters on one line', () => {
    expect(messageExportQuerySchema.safeParse({}).success).toBe(false);
    expect(messageExportQuerySchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(messageExportQuerySchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
    expect(messageExportQuerySchema.safeParse({ reason: 'one\ntwo' }).success).toBe(false);
    const ok = messageExportQuerySchema.safeParse({ reason: '  Quarterly review ' });
    expect(ok.success && ok.data.reason).toBe('Quarterly review');
  });
});
