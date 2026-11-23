// Every value here counts the code it runs instead of looping, so a regression fails rather than hangs.

import { describe, it, expect } from 'vitest';
import * as vm from 'node:vm';
import { isHostValue, ownString } from '../sandbox-value.js';

interface Foreign { readonly value: unknown; readonly touched: () => number }

/** `source` may count what runs in `touched`. */
function foreign(source: string): Foreign {
  const context = vm.createContext(Object.create(null) as object);
  vm.runInContext('var touched = 0; function touch() { touched += 1; }', context);
  const value = vm.runInContext(source, context) as unknown;
  return { value, touched: () => vm.runInContext('touched', context) as number };
}

const COUNTING_PROXY = 'new Proxy({}, new Proxy({}, { get: function () { touch(); return undefined; } }))';

describe('isHostValue', () => {
  it.each([
    ['a string', 'x'],
    ['undefined', undefined],
    ['null', null],
    ['a symbol', Symbol('x')],
    ['an error', new Error('x')],
    ['an error subclass', new (class Own extends TypeError {})('x')],
    ['a plain object', { message: 'x' }],
    ['an array', [1]],
    ['a function', (): void => undefined],
  ])('accepts %s of this realm', (_name, value) => {
    expect(isHostValue(value)).toBe(true);
  });

  it.each([
    ['an error', "new Error('x')"],
    ['a plain object', '({})'],
    ['an object with no prototype', 'Object.create(null)'],
    ['a function', '(function () {})'],
    ['an object of the global itself', 'globalThis'],
    ['a Proxy', COUNTING_PROXY],
    ['an object whose prototype is a Proxy', `Object.create(${COUNTING_PROXY})`],
    ['a revoked Proxy', 'var r = Proxy.revocable({}, {}); r.revoke(); r.proxy'],
  ])('refuses %s from a script, without running its code', (_name, source) => {
    const { value, touched } = foreign(source);

    expect(isHostValue(value)).toBe(false);
    expect(touched()).toBe(0);
  });

  it('refuses a host Proxy, whose traps could belong to anyone', () => {
    expect(isHostValue(new Proxy({}, {}))).toBe(false);
  });
});

describe('ownString', () => {
  it.each([
    ['an error', "new Error('own')", 'own'],
    ['a plain object', "({ message: 'own' })", 'own'],
    ['a function', "Object.assign(function () {}, { message: 'own' })", 'own'],
    ['an inherited message', "Object.create({ message: 'inherited' })", undefined],
    ['a message that is not a string', '({ message: { toString: touch } })', undefined],
    ['a message getter', "({ get message() { touch(); return 'x'; } })", undefined],
    ['a Proxy', COUNTING_PROXY, undefined],
    ['a string', "'text'", undefined],
    ['null', 'null', undefined],
  ])('reads %s without running its code', (_name, source, expected) => {
    const { value, touched } = foreign(source);

    expect(ownString(value, 'message')).toBe(expected);
    expect(touched()).toBe(0);
  });
});
