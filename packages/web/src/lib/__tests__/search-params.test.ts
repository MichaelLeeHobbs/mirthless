import { describe, it, expect } from 'vitest';
import { definedSearchParams } from '../search-params.js';

describe('definedSearchParams', () => {
  it('keeps the entries in the order the object lists them', () => {
    expect(definedSearchParams({ b: '2', a: '1', c: 3 }).toString()).toBe('b=2&a=1&c=3');
  });

  it('leaves out undefined and empty-string values', () => {
    expect(definedSearchParams({ a: undefined, b: '', c: 'x' }).toString()).toBe('c=x');
  });

  it('sends zero as text', () => {
    expect(definedSearchParams({ page: 0 }).toString()).toBe('page=0');
  });

  it('is empty when nothing is set', () => {
    expect(definedSearchParams({}).toString()).toBe('');
  });
});
