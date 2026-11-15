// ===========================================
// Destination templates: the placeholder rule
// ===========================================

import { describe, it, expect } from 'vitest';
import { renderDestinationTemplate } from '../destination-template.js';

function named(): number { return 1; }

const message = { encoded: 'ENCODED', raw: 'RAW', messageId: 42 };
const maps: readonly Readonly<Record<string, unknown>>[] = [
  { x: 'v', none: null, messageId: 'from a map', fn: named, nan: Number.NaN, shadowed: named },
  { none: 'second', obj: { a: 1 }, big: 10n, ref: '${x}', shadowed: 'from the second map' },
];

describe('renderDestinationTemplate', () => {
  it.each([
    ['a built-in name', '<${message.rawData}>', '<RAW>'],
    ['a built-in over a variable of the same name', '<${messageId}>', '<42>'],
    ['a plain name', '<${x}>', '<v>'],
    ['a padded name', '<${ x }>', '<v>'],
    ['a missing name', '<${y}>', '<${y}>'],
    ['a null value, from the next map', '<${none}>', '<second>'],
    ['an object value', '<${obj}>', '<{"a":1}>'],
    ['a bigint value', '<${big}>', '<10>'],
    ['a function value, left as written', '<${fn}>', '<${fn}>'],
    // A failed parseFloat in a transformer: written as NaN, as before the shared rule, not as null.
    ['a NaN value', '<${nan}>', '<NaN>'],
    // A function has no text, so the search goes on to the next map, as for null.
    ['a function value, from the next map', '<${shadowed}>', '<from the second map>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${x}', '<${ref}>', '<${x}>'],
  ])('fills %s by the shared rule', (_label, template, expected) => {
    expect(renderDestinationTemplate(template, message, maps)).toBe(expected);
  });
});
