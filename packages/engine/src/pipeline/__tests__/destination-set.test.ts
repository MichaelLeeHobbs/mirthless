// ===========================================
// Destination Set Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { DestinationSet, createDestinationSetProxy } from '../destination-set.js';

// ----- Test Data -----

const DESTINATIONS = [
  { name: 'Lab', metaDataId: 1 },
  { name: 'Pharmacy', metaDataId: 2 },
  { name: 'Billing', metaDataId: 3 },
] as const;

// ----- Tests -----

describe('DestinationSet', () => {
  let ds: DestinationSet;

  beforeEach(() => {
    ds = new DestinationSet(DESTINATIONS);
  });

  it('initializes with all destinations active', () => {
    expect(ds.contains('Lab')).toBe(true);
    expect(ds.contains('Pharmacy')).toBe(true);
    expect(ds.contains('Billing')).toBe(true);
  });

  it('removeAll clears all destinations', () => {
    ds.removeAll();
    expect(ds.contains('Lab')).toBe(false);
    expect(ds.contains('Pharmacy')).toBe(false);
    expect(ds.getConnectorNames()).toHaveLength(0);
    expect(ds.getActiveMetaDataIds().size).toBe(0);
  });

  it('remove removes a single destination', () => {
    ds.remove('Pharmacy');
    expect(ds.contains('Lab')).toBe(true);
    expect(ds.contains('Pharmacy')).toBe(false);
    expect(ds.contains('Billing')).toBe(true);
  });

  it('removeAllExcept keeps only the named destination', () => {
    ds.removeAllExcept('Lab');
    expect(ds.contains('Lab')).toBe(true);
    expect(ds.contains('Pharmacy')).toBe(false);
    expect(ds.contains('Billing')).toBe(false);
    expect(ds.getConnectorNames()).toEqual(['Lab']);
  });

  it('removeAllExcept with unknown name clears all', () => {
    ds.removeAllExcept('Unknown');
    expect(ds.getConnectorNames()).toHaveLength(0);
  });

  it('add re-adds a previously removed destination', () => {
    ds.remove('Lab');
    expect(ds.contains('Lab')).toBe(false);
    ds.add('Lab');
    expect(ds.contains('Lab')).toBe(true);
  });

  it('add ignores unknown connector names', () => {
    ds.add('Unknown');
    expect(ds.contains('Unknown')).toBe(false);
    expect(ds.getConnectorNames()).toHaveLength(3);
  });

  it('getConnectorNames returns active names', () => {
    ds.remove('Billing');
    const names = ds.getConnectorNames();
    expect(names).toContain('Lab');
    expect(names).toContain('Pharmacy');
    expect(names).not.toContain('Billing');
  });

  it('getActiveMetaDataIds returns correct IDs', () => {
    ds.remove('Pharmacy');
    const ids = ds.getActiveMetaDataIds();
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(false);
    expect(ids.has(3)).toBe(true);
  });
});

describe('createDestinationSetProxy', () => {
  it('proxy remove removes destination from underlying set', () => {
    const ds = new DestinationSet(DESTINATIONS);
    const proxy = createDestinationSetProxy(ds) as {
      remove: (name: string) => void;
      contains: (name: string) => boolean;
    };

    proxy.remove('Lab');
    expect(proxy.contains('Lab')).toBe(false);
    expect(ds.contains('Lab')).toBe(false);
  });

  it('proxy removeAll clears all destinations', () => {
    const ds = new DestinationSet(DESTINATIONS);
    const proxy = createDestinationSetProxy(ds) as {
      removeAll: () => void;
      getConnectorNames: () => ReadonlyArray<string>;
    };

    proxy.removeAll();
    expect(proxy.getConnectorNames()).toHaveLength(0);
  });

  it('proxy removeAllExcept keeps only named destination', () => {
    const ds = new DestinationSet(DESTINATIONS);
    const proxy = createDestinationSetProxy(ds) as {
      removeAllExcept: (name: string) => void;
      getConnectorNames: () => ReadonlyArray<string>;
    };

    proxy.removeAllExcept('Pharmacy');
    expect(proxy.getConnectorNames()).toEqual(['Pharmacy']);
  });
});
