// ===========================================
// List keys
// ===========================================

import { useCallback, useState } from 'react';

/** React keys for a list the user edits by position, and the moves to keep them with their items. */
export interface ListKeys {
  /** One key per item, in list order. */
  readonly keys: readonly number[];
  /** Call with the list's own remove: the item's key goes with it. */
  readonly remove: (index: number) => void;
  /** Call with the list's own swap of two items: their keys swap too. */
  readonly swap: (a: number, b: number) => void;
}

let lastKey = 0;

function newKeys(count: number): number[] {
  return Array.from({ length: count }, () => { lastKey += 1; return lastKey; });
}

/**
 * Stable React keys for items that have no id of their own (filter rules,
 * transformer steps). Keyed by position, a removed or moved item's component
 * went on showing another item, and its script editor kept the other item's
 * undo history (#228). Items added at the end get new keys; a list that
 * shrinks some other way drops the last keys.
 */
export function useListKeys(length: number): ListKeys {
  const [stored, setStored] = useState<readonly number[]>(() => newKeys(length));
  let keys = stored;
  if (stored.length !== length) {
    keys = stored.length < length ? [...stored, ...newKeys(length - stored.length)] : stored.slice(0, length);
    setStored(keys);
  }
  const remove = useCallback((index: number): void => {
    setStored((current) => current.filter((_, i) => i !== index));
  }, []);
  const swap = useCallback((a: number, b: number): void => {
    setStored((current) => current.map((key, i) => (i === a ? current[b] : i === b ? current[a] : key) ?? key));
  }, []);
  return { keys, remove, swap };
}
