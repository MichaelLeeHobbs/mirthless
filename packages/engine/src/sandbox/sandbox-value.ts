// Host code must not run a getter or Proxy trap on a value a script made: no time limit covers it.
// `instanceof` and reading `stack` (which calls the sandbox's Error.prepareStackTrace) both do.

import { types } from 'node:util';

/** A script can make a chain of any length, and the walk has no time limit. */
const MAX_PROTOTYPE_DEPTH = 100;

export const UNREADABLE_ERROR = 'Unreadable error value';

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/** Runs none of the object's code. Not for `stack`, whose text the sandbox's Error.prepareStackTrace may make. */
export function ownString(value: unknown, key: 'message' | 'code'): string | undefined {
  if (!isObject(value) || types.isProxy(value)) return undefined;
  const own = Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
  return typeof own === 'string' ? own : undefined;
}

/** The text of a thrown or rejected value a script may have made, read without running its code. */
export function thrownText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : ownString(value, 'message') ?? fallback;
}

/**
 * True when reading the value cannot run a script's code: a primitive, or an object whose
 * prototype chain ends in this realm. False for some host values too (a Proxy, or no prototype).
 */
export function isHostValue(value: unknown): boolean {
  if (!isObject(value)) return true;
  let current: object = value;
  for (let depth = 0; depth < MAX_PROTOTYPE_DEPTH; depth += 1) {
    if (types.isProxy(current)) return false;
    const prototype = Object.getPrototypeOf(current) as object | null;
    if (prototype === null) return current === Object.prototype;
    current = prototype;
  }
  return false;
}
