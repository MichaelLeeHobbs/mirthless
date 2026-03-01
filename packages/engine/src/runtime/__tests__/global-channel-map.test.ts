// ===========================================
// Global Channel Map Tests
// ===========================================

import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalChannelMap } from '../global-channel-map.js';

describe('GlobalChannelMap', () => {
  let gcm: GlobalChannelMap;

  beforeEach(() => {
    gcm = new GlobalChannelMap();
  });

  it('get returns undefined for missing key', () => {
    expect(gcm.get('missing')).toBeUndefined();
  });

  it('put and get store and retrieve a value', () => {
    gcm.put('key1', 'value1');
    expect(gcm.get('key1')).toBe('value1');
  });

  it('put overwrites existing value', () => {
    gcm.put('key1', 'old');
    gcm.put('key1', 'new');
    expect(gcm.get('key1')).toBe('new');
  });

  it('containsKey returns true for existing key', () => {
    gcm.put('exists', 42);
    expect(gcm.containsKey('exists')).toBe(true);
  });

  it('containsKey returns false for missing key', () => {
    expect(gcm.containsKey('nope')).toBe(false);
  });

  it('remove deletes a key and returns true', () => {
    gcm.put('key1', 'val');
    expect(gcm.remove('key1')).toBe(true);
    expect(gcm.get('key1')).toBeUndefined();
  });

  it('remove returns false for missing key', () => {
    expect(gcm.remove('nope')).toBe(false);
  });

  it('clear removes all entries', () => {
    gcm.put('a', 1);
    gcm.put('b', 2);
    gcm.clear();
    expect(gcm.get('a')).toBeUndefined();
    expect(gcm.get('b')).toBeUndefined();
  });

  it('toRecord returns a plain object snapshot', () => {
    gcm.put('x', 10);
    gcm.put('y', 'hello');
    const record = gcm.toRecord();
    expect(record).toEqual({ x: 10, y: 'hello' });
  });

  it('toRecord returns empty object when empty', () => {
    expect(gcm.toRecord()).toEqual({});
  });

  it('applyUpdates sets new keys and updates existing ones', () => {
    gcm.put('existing', 'old');
    gcm.applyUpdates({ existing: 'updated', newKey: 'newVal' });
    expect(gcm.get('existing')).toBe('updated');
    expect(gcm.get('newKey')).toBe('newVal');
  });

  it('applyUpdates removes keys set to undefined', () => {
    gcm.put('toRemove', 'val');
    gcm.applyUpdates({ toRemove: undefined });
    expect(gcm.containsKey('toRemove')).toBe(false);
  });
});
