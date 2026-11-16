// ===========================================
// Registry: FILE properties parsed by the core-models schema
// ===========================================

import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

describe('registry FILE factories', () => {
  // FILE_SOURCE_DEFAULTS and FILE_DEST_DEFAULTS from 7793c71 (2026-03) to today, `charset: 'UTF-8'` included, with the directory filled.
  it('build from the properties the editor saves', () => {
    expect(() => createSourceConnector('FILE', {
      directory: '/in', fileFilter: '*', pollingIntervalMs: 5000, sortBy: 'NAME', charset: 'UTF-8', binary: false,
      checkFileAge: true, fileAgeMs: 1000, postAction: 'DELETE', moveToDirectory: '',
    })).not.toThrow();
    expect(() => createDestinationConnector('FILE', {
      directory: '/out', outputPattern: '${messageId}.txt', charset: 'UTF-8', binary: false, tempFileEnabled: true, appendMode: false,
    })).not.toThrow();
  });

  // What the Mirth importer writes for a local File Reader and Writer.
  it('build an imported connector with the polling interval and batch keys', () => {
    expect(() => createSourceConnector('FILE', { directory: '/in', fileFilter: '*.hl7', moveToDirectory: '/done', pollingIntervalMs: 10_000, processBatch: true })).not.toThrow();
    expect(() => createDestinationConnector('FILE', { directory: '/out', template: '${message.encodedData}' })).not.toThrow();
  });

  it('build a source that reads dotfiles, and refuse ignoreDot stored as text (#244)', () => {
    expect(() => createSourceConnector('FILE', { directory: '/in', ignoreDot: false })).not.toThrow();
    expect(() => createSourceConnector('FILE', { directory: '/in', ignoreDot: 'false' })).toThrow(/ignoreDot/);
  });

  it('refuse a misspelled key instead of ignoring it', () => {
    expect(() => createSourceConnector('FILE', { directory: '/in', filePattern: '*.hl7' }))
      .toThrow(/FILE properties are invalid: .*filePattern/);
    expect(() => createDestinationConnector('FILE', { directory: '/out', fileNameTemplate: 'x.txt' }))
      .toThrow(/fileNameTemplate/);
  });

  it('refuse a sort order or post action the receiver does not implement, naming the key', () => {
    expect(() => createSourceConnector('FILE', { directory: '/in', sortBy: 'AGE' })).toThrow(/sortBy/);
    expect(() => createSourceConnector('FILE', { directory: '/in', postAction: 'ARCHIVE' })).toThrow(/postAction/);
  });

  it('refuse a switch stored as text rather than reading it as on', () => {
    expect(() => createDestinationConnector('FILE', { directory: '/out', appendMode: 'false' })).toThrow(/appendMode/);
  });
});
