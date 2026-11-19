import { useCallback, useState } from 'react';

export interface ListKeys {
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
 * For items with no id of their own. Keyed by position, a moved item's script
 * editor kept another item's undo history (#228). A list that shrinks other
 * than through `remove` drops the last keys.
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
