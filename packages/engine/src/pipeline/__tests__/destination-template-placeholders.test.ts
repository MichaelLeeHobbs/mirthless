// ===========================================
// Destination templates: the placeholder rule
// ===========================================

import { describe, it, expect } from 'vitest';
import { renderDestinationTemplate } from '../destination-template.js';

function named(): number { return 1; }

const message = { encoded: 'ENCODED', raw: 'RAW', messageId: 42 };
const maps: readonly Readonly<Record<string, unknown>>[] = [
  { x: 'v', none: null, messageId: 'from a map', fn: named },
  { none: 'second', obj: { a: 1 }, big: 10n, ref: '${x}' },
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
    ['a function value', '<${fn}>', '<undefined>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${x}', '<${ref}>', '<${x}>'],
  ])('fills %s by the shared rule', (_label, template, expected) => {
    expect(renderDestinationTemplate(template, message, maps)).toBe(expected);
  });
});
