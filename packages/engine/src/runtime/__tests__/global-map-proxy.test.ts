// ===========================================
// Global Map Proxy Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalMapProxy, type GlobalMapStore } from '../global-map-proxy.js';

function makeStore(): { store: GlobalMapStore; save: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; onFlushError: ReturnType<typeof vi.fn> } {
  const save = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const onFlushError = vi.fn();
  return { store: { save, remove, onFlushError }, save, remove, onFlushError };
}

describe('GlobalMapProxy', () => {
  let s: ReturnType<typeof makeStore>;
  let proxy: GlobalMapProxy;

  beforeEach(() => {
    s = makeStore();
    proxy = new GlobalMapProxy(s.store, 60_000); // long interval to avoid auto-flush
  });

  afterEach(async () => {
    await proxy.dispose();
  });

  describe('load', () => {
    it('loads plain text entries as strings, even when they look like numbers', () => {
      proxy.load([
        { key: 'k1', value: 'v1', isJson: false },
        { key: 'zip', value: '00501', isJson: false },
      ]);
      expect(proxy.toRecord()).toEqual({ k1: 'v1', zip: '00501' });
    });

    it('restores the original type of entries a script stored as JSON', () => {
      proxy.load([
        { key: 'count', value: '5', isJson: true },
        { key: 'seen', value: '{"a":[1,2]}', isJson: true },
        { key: 'flag', value: 'true', isJson: true },
      ]);
      expect(proxy.toRecord()).toEqual({ count: 5, seen: { a: [1, 2] }, flag: true });
    });

    it('keeps the raw text when a JSON entry cannot be parsed', () => {
      proxy.load([{ key: 'bad', value: '{oops', isJson: true }]);
      expect(proxy.toRecord()).toEqual({ bad: '{oops' });
    });

    it('handles null values in snapshot', () => {
      proxy.load([{ key: 'k1', value: null, isJson: false }]);
      expect(proxy.toRecord()['k1']).toBeNull();
    });
  });

  describe('applyChanges', () => {
    it('adds new keys and marks them for saving', async () => {
      const before = proxy.toRecord();
      proxy.applyChanges(before, { newKey: 'newValue' });
      expect(proxy.toRecord()['newKey']).toBe('newValue');
      await proxy.flush();
      expect(s.save).toHaveBeenCalledWith('newKey', 'newValue', false);
    });

    it('does not save keys the script left alone', async () => {
      proxy.load([{ key: 'k', value: 'v', isJson: false }, { key: 'o', value: '{"a":1}', isJson: true }]);
      const before = proxy.toRecord();
      // The sandbox hands back JSON copies, so unchanged objects are new instances.
      proxy.applyChanges(before, { k: 'v', o: { a: 1 } });
      await proxy.flush();
      expect(s.save).not.toHaveBeenCalled();
    });

    it('keeps a key another message wrote while this script was running', () => {
      proxy.load([{ key: 'a', value: '1', isJson: false }]);
      const beforeSlow = proxy.toRecord();
      // A second message finishes first and writes key b.
      proxy.applyChanges(proxy.toRecord(), { a: '1', b: 'fromFast' });
      // The slow script only changed key c; its stale snapshot has no b.
      proxy.applyChanges(beforeSlow, { a: '1', c: 'fromSlow' });
      expect(proxy.toRecord()).toEqual({ a: '1', b: 'fromFast', c: 'fromSlow' });
    });

    it('removes keys the script deleted', async () => {
      proxy.load([{ key: 'gone', value: 'x', isJson: false }]);
      proxy.applyChanges(proxy.toRecord(), {});
      expect('gone' in proxy.toRecord()).toBe(false);
      await proxy.flush();
      expect(s.remove).toHaveBeenCalledWith('gone');
      expect(s.save).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('saves strings verbatim and everything else as JSON', async () => {
      proxy.applyChanges({}, { text: '007', count: 7, obj: { a: [1] }, flag: false, nothing: null });
      await proxy.flush();
      expect(s.save).toHaveBeenCalledWith('text', '007', false);
      expect(s.save).toHaveBeenCalledWith('count', '7', true);
      expect(s.save).toHaveBeenCalledWith('obj', '{"a":[1]}', true);
      expect(s.save).toHaveBeenCalledWith('flag', 'false', true);
      expect(s.save).toHaveBeenCalledWith('nothing', 'null', true);
    });

    it('survives a save/load round trip with types intact', async () => {
      proxy.applyChanges({}, { count: 7, text: '7' });
      await proxy.flush();
      const rows = s.save.mock.calls.map((c) => ({ key: c[0] as string, value: c[1] as string, isJson: c[2] as boolean }));
      const next = new GlobalMapProxy(makeStore().store, 60_000);
      next.load(rows);
      expect(next.toRecord()).toEqual({ count: 7, text: '7' });
    });

    it('does nothing when there are no changes', async () => {
      await proxy.flush();
      expect(s.save).not.toHaveBeenCalled();
    });

    it('reports a failed save and retries it on the next flush', async () => {
      s.save.mockRejectedValueOnce(new Error('db down'));
      proxy.applyChanges({}, { k: 'v' });
      await proxy.flush();
      expect(s.onFlushError).toHaveBeenCalledWith('k', expect.objectContaining({ message: 'db down' }));
      await proxy.flush();
      expect(s.save).toHaveBeenCalledTimes(2);
    });

    it('never rejects, so the timer cannot raise an unhandled rejection', async () => {
      s.save.mockRejectedValue(new Error('db down'));
      proxy.applyChanges({}, { k: 'v' });
      await expect(proxy.flush()).resolves.toBeUndefined();
    });
  });

  describe('edits made outside scripts', () => {
    it('set replaces the value without saving it again', async () => {
      proxy.applyChanges({}, { k: 'fromScript' });
      proxy.set({ key: 'k', value: 'fromApi', isJson: false });
      expect(proxy.toRecord()['k']).toBe('fromApi');
      await proxy.flush();
      expect(s.save).not.toHaveBeenCalled();
    });

    it('delete and clear drop entries', () => {
      proxy.load([{ key: 'a', value: '1', isJson: false }, { key: 'b', value: '2', isJson: false }]);
      proxy.delete('a');
      expect(proxy.toRecord()).toEqual({ b: '2' });
      proxy.clear();
      expect(proxy.toRecord()).toEqual({});
    });
  });

  describe('timer', () => {
    it('flushes on the interval and stops on dispose', async () => {
      vi.useFakeTimers();
      try {
        const t = makeStore();
        const timed = new GlobalMapProxy(t.store, 100);
        timed.start();
        timed.start();
        timed.applyChanges({}, { k: 'v' });
        await vi.advanceTimersByTimeAsync(100);
        expect(t.save).toHaveBeenCalledTimes(1);
        timed.applyChanges({}, { k2: 'v2' });
        await timed.dispose();
        expect(t.save).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(500);
        expect(t.save).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
