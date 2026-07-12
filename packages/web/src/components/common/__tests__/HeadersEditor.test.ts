// ===========================================
// coerceHeaders Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { coerceHeaders } from '../HeadersEditor.js';

describe('coerceHeaders', () => {
  it('passes through a Record<string,string> unchanged', () => {
    expect(coerceHeaders({ 'X-Api-Key': 'abc', 'Content-Type': 'application/json' })).toEqual({
      'X-Api-Key': 'abc',
      'Content-Type': 'application/json',
    });
  });

  it('drops non-string values from an object', () => {
    expect(coerceHeaders({ a: 'x', b: 3, c: null } as unknown)).toEqual({ a: 'x' });
  });

  it('parses a legacy newline/colon delimited string into an object', () => {
    const raw = 'Authorization: Bearer xyz\nX-Trace: 42';
    expect(coerceHeaders(raw)).toEqual({ Authorization: 'Bearer xyz', 'X-Trace': '42' });
  });

  it('ignores malformed lines without a colon', () => {
    expect(coerceHeaders('garbage\nX-Ok: 1')).toEqual({ 'X-Ok': '1' });
  });

  it('returns an empty object for empty/undefined/array input', () => {
    expect(coerceHeaders('')).toEqual({});
    expect(coerceHeaders(undefined)).toEqual({});
    expect(coerceHeaders(['a', 'b'])).toEqual({});
  });
});
