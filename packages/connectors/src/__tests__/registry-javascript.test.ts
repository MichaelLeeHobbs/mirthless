// ===========================================
// Registry: JAVASCRIPT properties parsed by the core-models schema
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';
import type { JavaScriptReceiver } from '../javascript/javascript-receiver.js';

describe('registry JAVASCRIPT factories', () => {
  // JAVASCRIPT_SOURCE_DEFAULTS and JAVASCRIPT_DEST_DEFAULTS from 45fad27 (2026-03), then with scriptLanguage (1586daf), a script filled.
  it('build from the properties the editor saves', () => {
    expect(() => createSourceConnector('JAVASCRIPT', { script: 'return 1;', pollingIntervalMs: 5000 })).not.toThrow();
    expect(() => createSourceConnector('JAVASCRIPT', { script: 'return 1;', scriptLanguage: 'TYPESCRIPT', pollingIntervalMs: 5000 })).not.toThrow();
    expect(() => createDestinationConnector('JAVASCRIPT', { script: 'return msg;' })).not.toThrow();
    expect(() => createDestinationConnector('JAVASCRIPT', { script: 'return msg;', scriptLanguage: 'JAVASCRIPT' })).not.toThrow();
  });

  // What the Mirth importer writes today, and what it wrote before b06ba55 (2026-11-13): every Mirth property.
  it('build an imported connector, old imports included', () => {
    expect(() => createSourceConnector('JAVASCRIPT', { script: 'return 1;', pollingIntervalMs: 500, processBatch: true })).not.toThrow();
    expect(() => createSourceConnector('JAVASCRIPT', {
      pluginProperties: '', pollConnectorProperties: { pollingFrequency: '500' }, sourceConnectorProperties: { responseVariable: 'None' }, script: 'return 1;',
    })).not.toThrow();
    expect(() => createDestinationConnector('JAVASCRIPT', {
      pluginProperties: '', destinationConnectorProperties: { queueEnabled: 'false' }, script: 'return msg;',
    })).not.toThrow();
  });

  it('refuse a misspelled key instead of ignoring it', () => {
    expect(() => createSourceConnector('JAVASCRIPT', { script: 'return 1;', pollingInterval: 1000 }))
      .toThrow(/JAVASCRIPT properties are invalid: .*pollingInterval/);
    expect(() => createDestinationConnector('JAVASCRIPT', { script: 'return msg;', language: 'TYPESCRIPT' }))
      .toThrow(/language/);
  });

  it('refuse a polling interval the receiver would refuse, naming the key', () => {
    expect(() => createSourceConnector('JAVASCRIPT', { script: 'return 1;', pollingIntervalMs: 50 })).toThrow(/pollingIntervalMs/);
  });

  it('pass the parsed polling interval to the receiver', async () => {
    vi.useFakeTimers();
    try {
      const receiver = createSourceConnector('JAVASCRIPT', { script: 'return 1;', pollingIntervalMs: '200' }) as JavaScriptReceiver;
      const runner = vi.fn(async () => ({ ok: true as const, value: null, error: null }));
      receiver.setScriptRunner(runner);
      receiver.setDispatcher(vi.fn());
      expect((await receiver.onStart()).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(199);
      expect(runner).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(runner).toHaveBeenCalledTimes(1);
      await receiver.onStop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuse a missing script, naming the key', () => {
    expect(() => createSourceConnector('JAVASCRIPT', {})).toThrow(/script/);
    expect(() => createDestinationConnector('JAVASCRIPT', { script: ' ' })).toThrow(/script/);
  });
});
