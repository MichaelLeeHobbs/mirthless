import { describe, it, expect } from 'vitest';
import { num } from '../registry.js';

describe('registry num() coercion', () => {
  it('returns a numeric value as-is', () => {
    expect(num({ port: 6661 }, 'port', 0)).toBe(6661);
  });

  it('coerces a numeric string (e.g. from a JSON/UI config) to a number', () => {
    expect(num({ port: '6661' }, 'port', 0)).toBe(6661);
    expect(typeof num({ port: '6661' }, 'port', 0)).toBe('number');
  });

  it('falls back for missing, empty, null, or non-numeric values', () => {
    expect(num({}, 'port', 22)).toBe(22);
    expect(num({ port: '' }, 'port', 22)).toBe(22);
    expect(num({ port: null }, 'port', 22)).toBe(22);
    expect(num({ port: 'abc' }, 'port', 22)).toBe(22);
    expect(num({ port: undefined }, 'port', 22)).toBe(22);
  });
});
