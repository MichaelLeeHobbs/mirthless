import { describe, expect, it } from 'vitest';
import { connectorLookup, nextNumber, planDestinations } from '../destination-numbers.js';

const LAB = { id: 'lab', metaDataId: 1 };
const CLINIC = { id: 'clinic', metaDataId: 2 };

describe('nextNumber', () => {
  it.each([
    ['the channel\'s own', 5, [LAB, CLINIC], 5],
    ['past one that was written without raising it', 1, [LAB, CLINIC], 3],
    ['1 for a channel with none', 1, [], 1],
  ])('is %s', (_what, next, stored, expected) => {
    expect(nextNumber(next, stored)).toBe(expected);
  });
});

describe('planDestinations', () => {
  it('keeps the number and the row of each destination the channel has, in whatever order', () => {
    expect(planDestinations(['clinic', 'lab'], [LAB, CLINIC], 3)).toEqual({
      rows: [{ ...CLINIC, isNew: false }, { ...LAB, isNew: false }], removed: [], next: 3,
    });
  });

  it('gives a new destination the next number, never that of one it removes', () => {
    const plan = planDestinations(['new-1', 'clinic', 'new-2'], [LAB, CLINIC], 3);

    expect(plan.rows.map((r) => [r.metaDataId, r.isNew])).toEqual([[3, true], [2, false], [4, true]]);
    expect(plan.removed).toEqual(['lab']);
    expect(plan.next).toBe(5);
    const [first, , second] = plan.rows;
    expect(first!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first!.id).not.toBe(second!.id);
  });

  it('does not give out the number of one that was removed before', () => {
    expect(planDestinations(['lab', 'new'], [LAB], 3).rows.map((r) => r.metaDataId)).toEqual([1, 3]);
  });

  it('refuses an id that the channel gave out and no longer has, or that another channel has, rather than renumber the destination', () => {
    const gone = '3f0c9f3e-0000-4000-8000-000000000001';
    expect(() => planDestinations(['lab', gone], [LAB], 2)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining(`no destination with the id "${gone}"`) }));
    expect(planDestinations([gone], [{ id: gone, metaDataId: 1 }], 2).rows).toEqual([{ id: gone, metaDataId: 1, isNew: false }]);
    for (const other of [`{${gone}}`, gone.replaceAll('-', '')]) {
      expect(() => planDestinations([other], [{ id: gone, metaDataId: 1 }], 2)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
    for (const made of ['new-1', 'deadbeef', `${gone}x`]) expect(planDestinations([made], [], 1).rows).toMatchObject([{ isNew: true }]);
  });

  it('refuses two destinations with one id', () => {
    expect(() => planDestinations(['lab', 'lab'], [LAB], 2)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: 'Two destinations have the id "lab"' }));
  });
});

describe('connectorLookup', () => {
  const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
  const lookup = connectorLookup(['lab', undefined, 'new'], rows);

  it('refuses two destinations with one id, not two without', () => {
    expect(() => connectorLookup(['lab', 'new', 'lab'], rows)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: 'Two destinations have the id "lab"' }));
    expect(connectorLookup([undefined, undefined, 'new'], rows)({ connectorId: 'new', metaDataId: null }, 'A filter')).toBe('r3');
  });

  it.each([
    ['the source', { connectorId: null, metaDataId: null }, null],
    ['a destination by what the request calls it', { connectorId: 'new', metaDataId: null }, 'r3'],
    ['a destination by its place', { connectorId: null, metaDataId: 2 }, 'r2'],
  ])('finds %s', (_what, ref, expected) => {
    expect(lookup(ref, 'A filter')).toBe(expected);
  });

  it.each([
    ['an id the request does not have', { connectorId: 'gone', metaDataId: null }, 'does not have'],
    ['a place past the last', { connectorId: null, metaDataId: 4 }, 'does not have'],
    ['both', { connectorId: 'lab', metaDataId: 1 }, 'twice'],
  ])('refuses %s, rather than take it for the source', (_what, ref, message) => {
    expect(() => lookup(ref, 'A filter')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining(message) }));
  });
});
