// ===========================================
// Global Map Proxy Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalMapProxy } from '../global-map-proxy.js';

// ----- Tests -----

describe('GlobalMapProxy', () => {
  let mockFlush: ReturnType<typeof vi.fn>;
  let proxy: GlobalMapProxy;

  beforeEach(() => {
    mockFlush = vi.fn().mockResolvedValue(undefined);
    proxy = new GlobalMapProxy(mockFlush, 60_000); // long interval to avoid auto-flush
  });

  afterEach(async () => {
    await proxy.dispose();
  });

  describe('load', () => {
    it('loads initial entries from snapshot', () => {
      proxy.load([
        { key: 'k1', value: 'v1' },
        { key: 'k2', value: 'v2' },
      ]);

      const record = proxy.toRecord();
      expect(record['k1']).toBe('v1');
      expect(record['k2']).toBe('v2');
    });

    it('handles null values in snapshot', () => {
      proxy.load([{ key: 'k1', value: null }]);

      const record = proxy.toRecord();
      expect(record['k1']).toBeNull();
    });
  });

  describe('toRecord', () => {
    it('returns empty record when no entries loaded', () => {
      expect(proxy.toRecord()).toEqual({});
    });

    it('returns snapshot of current state', () => {
      proxy.load([{ key: 'a', value: 'b' }]);
      const record = proxy.toRecord();
      expect(record).toEqual({ a: 'b' });
    });
  });

  describe('applyUpdates', () => {
    it('adds new keys', () => {
      proxy.applyUpdates({ newKey: 'newValue' });
      expect(proxy.toRecord()['newKey']).toBe('newValue');
    });

    it('updates existing keys', () => {
      proxy.load([{ key: 'k1', value: 'old' }]);
      proxy.applyUpdates({ k1: 'new' });
      expect(proxy.toRecord()['k1']).toBe('new');
    });

    it('marks changed keys as dirty', async () => {
      proxy.applyUpdates({ k1: 'v1' });
      await proxy.flush();
      expect(mockFlush).toHaveBeenCalledWith('k1', 'v1');
    });

    it('does not mark unchanged keys as dirty', async () => {
      proxy.load([{ key: 'k1', value: 'same' }]);
      proxy.applyUpdates({ k1: 'same' });
      await proxy.flush();
      expect(mockFlush).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('does nothing when no dirty keys', async () => {
      await proxy.flush();
      expect(mockFlush).not.toHaveBeenCalled();
    });

    it('flushes all dirty keys', async () => {
      proxy.applyUpdates({ k1: 'v1', k2: 'v2' });
      await proxy.flush();
      expect(mockFlush).toHaveBeenCalledTimes(2);
      expect(mockFlush).toHaveBeenCalledWith('k1', 'v1');
      expect(mockFlush).toHaveBeenCalledWith('k2', 'v2');
    });

    it('clears dirty set after flush', async () => {
      proxy.applyUpdates({ k1: 'v1' });
      await proxy.flush();
      mockFlush.mockClear();

      await proxy.flush();
      expect(mockFlush).not.toHaveBeenCalled();
    });

    it('converts non-string values to string', async () => {
      proxy.applyUpdates({ num: 42 });
      await proxy.flush();
      expect(mockFlush).toHaveBeenCalledWith('num', '42');
    });

    it('converts null/undefined to empty string', async () => {
      proxy.applyUpdates({ empty: null });
      await proxy.flush();
      expect(mockFlush).toHaveBeenCalledWith('empty', '');
    });
  });

  describe('dispose', () => {
    it('flushes remaining dirty keys on dispose', async () => {
      proxy.applyUpdates({ k1: 'v1' });
      await proxy.dispose();
      expect(mockFlush).toHaveBeenCalledWith('k1', 'v1');
    });

    it('stops the flush timer on dispose', async () => {
      proxy.start();
      proxy.applyUpdates({ k1: 'v1' });
      await proxy.dispose();
      // Dispose should have flushed the dirty key
      expect(mockFlush).toHaveBeenCalledTimes(1);
      mockFlush.mockClear();
      // After dispose, further updates should not auto-flush
      proxy.applyUpdates({ k2: 'v2' });
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      // Timer is stopped, so no additional flush
      expect(mockFlush).toHaveBeenCalledTimes(0);
    });
  });

  describe('periodic flush', () => {
    it('starts periodic timer', async () => {
      vi.useFakeTimers();
      const fastProxy = new GlobalMapProxy(mockFlush, 100);

      fastProxy.start();
      fastProxy.applyUpdates({ k1: 'v1' });

      await vi.advanceTimersByTimeAsync(150);

      expect(mockFlush).toHaveBeenCalled();

      await fastProxy.dispose();
      vi.useRealTimers();
    });
  });
});
