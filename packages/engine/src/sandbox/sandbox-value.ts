// Host code must not run a getter or Proxy trap on a value a script made: no time limit covers it.
// `instanceof` and reading `stack` (which calls the sandbox's Error.prepareStackTrace) both do.

import { types } from 'node:util';

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/** Runs none of the object's code. Not for `stack`, whose text the sandbox's Error.prepareStackTrace may make. */
export function ownString(value: unknown, key: 'message' | 'code'): string | undefined {
  if (!isObject(value) || types.isProxy(value)) return undefined;
  const own = Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
  return typeof own === 'string' ? own : undefined;
}

/** True for a primitive and for an object of this realm; runs none of the object's code. */
export function isHostValue(value: unknown): boolean {
  if (!isObject(value)) return true;
  let current: object = value;
  for (;;) {
    if (types.isProxy(current)) return false;
    const prototype = Object.getPrototypeOf(current) as object | null;
    if (prototype === null) return current === Object.prototype;
    current = prototype;
  }
}
