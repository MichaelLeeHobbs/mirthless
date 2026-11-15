// ===========================================
// Configuration references: the placeholder rule
// ===========================================
// Configuration values are strings, so the object and bigint rows of the
// shared rule cannot occur here.

import { describe, it, expect } from 'vitest';
import { configLookup, resolveConfigReferences } from '../config-references.js';

const lookup = configLookup([
  { category: 'vns', name: 'HOST', value: 'lis.example.org' },
  { category: 'vns', name: 'UNSET', value: null },
  { category: 'vns', name: 'REF', value: '${HOST}' },
]);

function resolve(text: string): unknown {
  return resolveConfigReferences({ host: text }, lookup)['host'];
}

describe('resolveConfigReferences', () => {
  it.each([
    ['a plain name', '<${HOST}>', '<lis.example.org>'],
    ['a padded name', '<${ vns.HOST }>', '<lis.example.org>'],
    ['a missing name', '<${oru}>', '<${oru}>'],
    ['a null value', '<${UNSET}>', '<${UNSET}>'],
    ['an inherited key', '<${toString}>', '<${toString}>'],
    ['a value containing ${HOST}', '<${REF}>', '<${HOST}>'],
  ])('fills %s by the shared rule', (_label, text, expected) => {
    expect(resolve(text)).toBe(expected);
  });
});
