// ===========================================
// JAVASCRIPT Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  javascriptSourcePropertiesSchema,
  javascriptDestinationPropertiesSchema,
} from '../javascript-connector.schema.js';

describe('javascriptSourcePropertiesSchema', () => {
  it('needs a script and fills the polling interval', () => {
    expect(javascriptSourcePropertiesSchema.parse({ script: 'return "x";' })).toEqual({ script: 'return "x";', pollingIntervalMs: 5000 });
  });

  it('accepts every key the connector, the engine and the deploy type check read', () => {
    const all = { script: 'return "x";', scriptLanguage: 'TYPESCRIPT', pollingIntervalMs: '100', processBatch: true };
    expect(javascriptSourcePropertiesSchema.parse(all)).toEqual({ ...all, pollingIntervalMs: 100 });
  });

  // JAVASCRIPT_SOURCE_DEFAULTS from 45fad27 (2026-02) and 1586daf (2026-11-15, scriptLanguage), with a script.
  it.each([
    [{ script: 'return 1;', pollingIntervalMs: 5000 }],
    [{ script: 'return 1;', scriptLanguage: 'JAVASCRIPT', pollingIntervalMs: 5000 }],
  ])('accepts what the editor saved: %j', (saved) => {
    expect(javascriptSourcePropertiesSchema.parse(saved)).toEqual(saved);
  });

  // The Mirth importer copied all of a JavaScript Reader's properties until b06ba55 (2026-11-13).
  it('drops the Mirth keys the old importer copied and nothing read', () => {
    const imported = {
      pluginProperties: '', pollConnectorProperties: { pollingType: 'INTERVAL', pollingFrequency: '500' },
      sourceConnectorProperties: { responseVariable: 'None', processBatch: 'true' }, script: "return 'tick';",
    };
    expect(javascriptSourcePropertiesSchema.parse(imported)).toEqual({ script: "return 'tick';", pollingIntervalMs: 5000 });
  });

  it.each([
    ['script', ''],
    ['script', '  \n'],
    ['script', 42],
    ['scriptLanguage', 'typescript'],
    ['scriptLanguage', 'PYTHON'],
    ['pollingIntervalMs', 99],
    ['pollingIntervalMs', 1.5],
    ['processBatch', 'true'],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = javascriptSourcePropertiesSchema.safeParse({ script: 'return 1;', [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([key]);
  });

  it('needs a script', () => {
    const result = javascriptSourcePropertiesSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['script']);
  });

  it('refuses a key it does not list', () => {
    const result = javascriptSourcePropertiesSchema.safeParse({ script: 'return 1;', pollInterval: 1000 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain('pollInterval');
  });
});

describe('javascriptDestinationPropertiesSchema', () => {
  // JAVASCRIPT_DEST_DEFAULTS from 45fad27 (2026-02) and 1586daf (2026-11-15), with a script.
  it.each([
    [{ script: 'return msg;' }],
    [{ script: 'return msg;', scriptLanguage: 'TYPESCRIPT' }],
    [{ script: 'return msg;', template: '${message.encodedData}' }],
  ])('accepts %j as it is', (saved) => {
    expect(javascriptDestinationPropertiesSchema.parse(saved)).toEqual(saved);
  });

  it('drops the Mirth keys the old importer copied and nothing read', () => {
    const imported = { pluginProperties: '', destinationConnectorProperties: { queueEnabled: 'false' }, script: 'return msg;' };
    expect(javascriptDestinationPropertiesSchema.parse(imported)).toEqual({ script: 'return msg;' });
  });

  it.each([
    ['script', ''],
    ['scriptLanguage', 'JS'],
    ['template', 7],
    ['pollingIntervalMs', 5000],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = javascriptDestinationPropertiesSchema.safeParse({ script: 'return msg;', [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});
