import { describe, it, expect } from 'vitest';
import { diffMap } from '../map-diff.js';

describe('diffMap', () => {
  it('reports nothing when the maps hold equal values', () => {
    expect(diffMap({ a: 1, o: { x: [1] } }, { a: 1, o: { x: [1] } })).toEqual({ set: [], removed: [] });
  });

  it('reports added and changed keys', () => {
    expect(diffMap({ a: 1, b: 'x' }, { a: 2, b: 'x', c: null })).toEqual({ set: [['a', 2], ['c', null]], removed: [] });
  });

  it('tells a number from the text that looks like it', () => {
    expect(diffMap({ a: 1 }, { a: '1' }).set).toEqual([['a', '1']]);
  });

  it('reports a nested change', () => {
    expect(diffMap({ o: { x: 1 } }, { o: { x: 2 } }).set).toEqual([['o', { x: 2 }]]);
  });

  it('reports removed keys, and treats undefined as removed', () => {
    expect(diffMap({ a: 1, b: 2 }, { b: undefined })).toEqual({ set: [], removed: ['a', 'b'] });
  });

  it('treats a value that cannot be compared as changed', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(diffMap({ a: {} }, { a: loop }).set).toHaveLength(1);
  });
});
