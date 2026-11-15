// ===========================================
// File/SFTP output filenames: the placeholder rule
// ===========================================

import { describe, it, expect } from 'vitest';
import { resolveOutputFilename, unknownPlaceholders } from '../file-dispatcher.js';

// Non-string values reach the context only through a cast; the rows pin what
// the substitution does with them.
const context = {
  x: 'v',
  none: null,
  obj: { a: 1 },
  big: 10n,
  ref: '${x}',
} as unknown as Readonly<Record<string, string>>;

describe('resolveOutputFilename', () => {
  it.each([
    ['a plain name', '${x}.txt', 'v.txt'],
    ['a padded name', '${ x }.txt', '${ x }.txt'],
    ['a missing name', '${y}.txt', '${y}.txt'],
    ['a null value', '${none}.txt', '${none}.txt'],
    ['an object value', '${obj}.txt', '[object Object].txt'],
    ['a bigint value', '${big}.txt', '10.txt'],
    ['an inherited key', '${toString}.txt', '${toString}.txt'],
    ['a value containing ${x}', '${ref}.txt', '${x}.txt'],
  ])('fills %s by the shared rule', (_label, pattern, expected) => {
    expect(resolveOutputFilename(pattern, context)).toBe(expected);
  });
});

describe('unknownPlaceholders', () => {
  it.each([
    ['known names', '${messageId}_${timestamp}.txt', []],
    ['an unknown name, once', '${a}_${a}.txt', ['a']],
    ['a dotted name', '${a.b}.txt', ['a.b']],
    ['an empty placeholder', '${}.txt', ['']],
    ['a padded known name', '${ messageId }.txt', [' messageId ']],
  ])('reports %s', (_label, pattern, expected) => {
    expect(unknownPlaceholders(pattern)).toEqual(expected);
  });
});
