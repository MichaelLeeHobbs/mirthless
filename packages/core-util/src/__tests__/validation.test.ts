import { describe, it, expect } from 'vitest';
import { isPlainObject } from '../validation.js';

describe('isPlainObject', () => {
  it('accepts objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('rejects null, arrays and primitives', () => {
    for (const value of [null, undefined, [], [1], 'x', 0, true, Symbol('s'), () => 1]) {
      expect(isPlainObject(value)).toBe(false);
    }
  });
});
