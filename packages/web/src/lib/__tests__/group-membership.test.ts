import { describe, it, expect } from 'vitest';
import { isSameGroupSet } from '../group-membership.js';

describe('isSameGroupSet', () => {
  it('is true for the same groups in another order', () => {
    expect(isSameGroupSet(['g1', 'g2'], ['g2', 'g1'])).toBe(true);
  });

  it('is true for two empty lists', () => {
    expect(isSameGroupSet([], [])).toBe(true);
  });

  it('is false when one list has a group the other lacks', () => {
    expect(isSameGroupSet(['g1'], ['g1', 'g2'])).toBe(false);
    expect(isSameGroupSet(['g1', 'g2'], ['g1'])).toBe(false);
  });

  it('is false for different groups of the same size', () => {
    expect(isSameGroupSet(['g1'], ['g2'])).toBe(false);
  });
});
