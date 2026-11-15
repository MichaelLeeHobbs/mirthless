// ===========================================
// fillVariables: the placeholder rule for connector settings
// ===========================================

import { describe, it, expect } from 'vitest';
import { fillVariables } from '../base.js';

const variables: Readonly<Record<string, unknown>> = {
  x: 'v',
  none: null,
  obj: { a: 1 },
  big: 10n,
  ref: '${x}',
};

describe('fillVariables', () => {
  it.each([
    ['a plain name', '<${x}>', '<v>'],
    ['a padded name', '<${ x }>', '<v>'],
    ['a missing name', '<${y}>', '<${y}>'],
    ['a null value', '<${none}>', '<${none}>'],
    ['an object value', '<${obj}>', '<{"a":1}>'],
    ['an inherited key', '<${toString}>', '<undefined>'],
    ['a value containing ${x}', '<${ref}>', '<${x}>'],
  ])('fills %s by the shared rule', (_label, text, expected) => {
    expect(fillVariables(text, { variables })).toBe(expected);
  });

  it('throws on a bigint value', () => {
    expect(() => fillVariables('<${big}>', { variables })).toThrow(TypeError);
  });

  it('returns the text unchanged when the message has no variables', () => {
    expect(fillVariables('<${x}>', {})).toBe('<${x}>');
  });
});
