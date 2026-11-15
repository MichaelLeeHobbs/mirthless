// ===========================================
// ${name} placeholder tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { fillPlaceholders, placeholderNames, placeholderText, recordLookup } from '../placeholders.js';

const variables: Readonly<Record<string, unknown>> = {
  x: 'v',
  none: null,
  undef: undefined,
  obj: { a: 1 },
  list: [1, 'two'],
  num: 3,
  flag: false,
  big: 10n,
  ref: '${x}',
  '': 'empty name',
};

describe('placeholderText', () => {
  it.each([
    ['a string as it is', 'a "b"', 'a "b"'],
    ['a bigint as decimal digits', -12345678901234567890n, '-12345678901234567890'],
    ['a number as JSON', 1.5, '1.5'],
    // JSON would write these as "null", which reads like a real value in an outbound message.
    ['NaN as NaN', Number.NaN, 'NaN'],
    ['Infinity as Infinity', Number.NEGATIVE_INFINITY, '-Infinity'],
    ['a boolean as JSON', true, 'true'],
    ['an object as JSON', { a: [1] }, '{"a":[1]}'],
    ['a function as the text undefined', (): number => 1, 'undefined'],
  ])('writes %s', (_label, value, expected) => {
    expect(placeholderText(value)).toBe(expected);
  });
});

describe('fillPlaceholders', () => {
  const lookup = recordLookup(variables);

  it.each([
    ['a plain name', '<${x}>', '<v>'],
    ['a padded name', '<${  x\t}>', '<v>'],
    ['a missing name as written', '<${y}>', '<${y}>'],
    ['a null value as written', '<${none}>', '<${none}>'],
    ['an undefined value as written', '<${undef}>', '<${undef}>'],
    ['an object as JSON', '<${obj}>', '<{"a":1}>'],
    ['an array as JSON', '<${list}>', '<[1,"two"]>'],
    ['a number and a false boolean', '<${num}|${flag}>', '<3|false>'],
    ['a bigint as its digits', '<${big}>', '<10>'],
    ['an inherited key as written', '<${toString}|${constructor}>', '<${toString}|${constructor}>'],
    ['an empty or blank name as written', '<${}|${ }>', '<${}|${ }>'],
    ['a value containing ${x} without expanding it', '<${ref}>', '<${x}>'],
    ['each of several placeholders', '${x}-${x}-${y}', 'v-v-${y}'],
    ['replacement patterns in a value literally', '${dollar}', '$& $1 $$'],
    // A function or symbol has no text worth sending: left as written, like a missing name.
    ['a function or symbol value as written', '<${fn}|${sym}>', '<${fn}|${sym}>'],
  ])('fills %s', (_label, text, expected) => {
    const extra: Readonly<Record<string, unknown>> = { dollar: '$& $1 $$', fn: (): number => 1, sym: Symbol('s') };
    const withDollar = (name: string): unknown => (Object.hasOwn(extra, name) ? extra[name] : lookup(name));
    expect(fillPlaceholders(text, withDollar)).toBe(expected);
  });

  it('returns text with no placeholder without calling the look-up', () => {
    const spy = vi.fn();
    expect(fillPlaceholders('plain $ {x} text', spy)).toBe('plain $ {x} text');
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes the trimmed name to the look-up', () => {
    const spy = vi.fn().mockReturnValue('ok');
    expect(fillPlaceholders('${ a.b-c d }', spy)).toBe('ok');
    expect(spy).toHaveBeenCalledWith('a.b-c d');
  });
});

describe('recordLookup', () => {
  it('finds own keys only', () => {
    const lookup = recordLookup({ own: 1 });
    expect(lookup('own')).toBe(1);
    expect(lookup('toString')).toBeUndefined();
    expect(lookup('hasOwnProperty')).toBeUndefined();
  });

  it('works on a record with no prototype', () => {
    const record = Object.assign(Object.create(null) as Record<string, unknown>, { a: 'b' });
    expect(recordLookup(record)('a')).toBe('b');
  });
});

describe('placeholderNames', () => {
  it.each([
    ['no placeholders', 'plain', []],
    ['names in order, each once', '${b} ${a} ${b}', ['b', 'a']],
    ['trimmed names, merging padded copies', '${ a } ${a}', ['a']],
    ['names with dots, spaces and dashes', '${a.b} ${c d} ${e-f}', ['a.b', 'c d', 'e-f']],
    ['an empty or blank placeholder as an empty name', '${} ${  }', ['']],
  ])('lists %s', (_label, text, expected) => {
    expect(placeholderNames(text)).toEqual(expected);
  });
});
