import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListKeys } from '../use-list-keys.js';

describe('useListKeys', () => {
  it('gives each item its own key', () => {
    const { result } = renderHook(() => useListKeys(3));
    expect(new Set(result.current.keys).size).toBe(3);
  });

  it('keeps the existing keys and adds a new one when an item is added', () => {
    const { result, rerender } = renderHook(({ n }) => useListKeys(n), { initialProps: { n: 2 } });
    const before = [...result.current.keys];
    rerender({ n: 3 });
    expect(result.current.keys.slice(0, 2)).toEqual(before);
    expect(before).not.toContain(result.current.keys[2]);
  });

  it('takes a removed item\'s key out and keeps the others in order', () => {
    const { result, rerender } = renderHook(({ n }) => useListKeys(n), { initialProps: { n: 3 } });
    const [a, , c] = result.current.keys;
    act(() => { result.current.remove(1); });
    rerender({ n: 2 });
    expect(result.current.keys).toEqual([a, c]);
  });

  it('swaps two items\' keys', () => {
    const { result } = renderHook(() => useListKeys(3));
    const [a, b, c] = result.current.keys;
    act(() => { result.current.swap(0, 1); });
    expect(result.current.keys).toEqual([b, a, c]);
  });

  it('drops the last keys when the list shrinks without a remove (a reload)', () => {
    const { result, rerender } = renderHook(({ n }) => useListKeys(n), { initialProps: { n: 3 } });
    const [a, b] = result.current.keys;
    rerender({ n: 2 });
    expect(result.current.keys).toEqual([a, b]);
  });
});
