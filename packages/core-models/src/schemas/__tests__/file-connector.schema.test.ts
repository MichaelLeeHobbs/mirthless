// ===========================================
// FILE Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  fileSourcePropertiesSchema,
  fileDestinationPropertiesSchema,
  FILE_SORT_ORDERS,
  FILE_POST_ACTIONS,
} from '../file-connector.schema.js';

const SOURCE_DEFAULTS = {
  fileFilter: '*', ignoreDot: true, pollingIntervalMs: 5000, sortBy: 'NAME', charset: 'utf-8', binary: false,
  checkFileAge: true, fileAgeMs: 1000, postAction: 'DELETE', moveToDirectory: '',
};

const DESTINATION_DEFAULTS = {
  outputPattern: '${messageId}.txt', charset: 'utf-8', binary: false, tempFileEnabled: true, appendMode: false,
};

describe('fileSourcePropertiesSchema', () => {
  it('needs a directory and fills the defaults', () => {
    expect(fileSourcePropertiesSchema.parse({ directory: '/in' })).toEqual({ directory: '/in', ...SOURCE_DEFAULTS });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      directory: '/in', fileFilter: '*.hl7', ignoreDot: false, pollingIntervalMs: '100', sortBy: 'SIZE', charset: 'latin1', binary: true,
      checkFileAge: false, fileAgeMs: 0, postAction: 'MOVE', moveToDirectory: '/done', processBatch: true,
    };
    expect(fileSourcePropertiesSchema.parse(all)).toEqual({ ...all, pollingIntervalMs: 100 });
  });

  it.each([
    ['directory', ''],
    ['directory', '  '],
    ['fileFilter', ''],
    ['pollingIntervalMs', 99],
    ['pollingIntervalMs', 2_147_483_648],
    ['pollingIntervalMs', 'often'],
    ['sortBy', 'AGE'],
    ['charset', 'windows-1252'],
    ['binary', 'true'],
    ['ignoreDot', 'false'],
    ['checkFileAge', 1],
    ['fileAgeMs', -1],
    ['fileAgeMs', 1.5],
    ['postAction', 'ARCHIVE'],
    ['moveToDirectory', null],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = fileSourcePropertiesSchema.safeParse({ directory: '/in', [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([key]);
  });

  it('needs a move-to directory when the post action is MOVE', () => {
    const result = fileSourcePropertiesSchema.safeParse({ directory: '/in', postAction: 'MOVE', moveToDirectory: ' ' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['moveToDirectory']);
    expect(result.error.issues[0]?.message).toBe('required when postAction is MOVE');
  });

  it('rejects a key it does not know, naming it', () => {
    const result = fileSourcePropertiesSchema.safeParse({ directory: '/in', filePattern: '*.hl7' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('filePattern');
  });

  // FILE_SOURCE_DEFAULTS from 7793c71 (2026-03) to today, with the directory filled.
  it('deploys a source the editor saved, reading charset UTF-8 as utf-8', () => {
    const saved = { directory: '/in', fileFilter: '*', pollingIntervalMs: 5000, sortBy: 'NAME', charset: 'UTF-8', binary: false, checkFileAge: true, fileAgeMs: 1000, postAction: 'DELETE', moveToDirectory: '' };
    expect(fileSourcePropertiesSchema.parse(saved)).toEqual({ ...saved, charset: 'utf-8' });
  });

  // The charset choices the forms offered from 7793c71 until 439267a (2026-07).
  it.each([
    ['UTF-8', 'utf-8'], ['ISO-8859-1', 'latin1'], ['US-ASCII', 'ascii'],
  ])('reads the old charset choice %j as %j', (given, expected) => {
    expect(fileSourcePropertiesSchema.parse({ directory: '/in', charset: given }).charset).toBe(expected);
  });
});

describe('fileDestinationPropertiesSchema', () => {
  it('needs a directory and fills the defaults', () => {
    expect(fileDestinationPropertiesSchema.parse({ directory: '/out' })).toEqual({ directory: '/out', ...DESTINATION_DEFAULTS });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      directory: '/out', outputPattern: '${timestamp}.hl7', charset: 'utf16le', binary: true,
      tempFileEnabled: false, appendMode: true, template: '${message.encodedData}',
    };
    expect(fileDestinationPropertiesSchema.parse(all)).toEqual(all);
  });

  it.each([
    ['directory', ''],
    ['outputPattern', ''],
    ['charset', 'cp1252'],
    ['binary', 0],
    ['tempFileEnabled', 'false'],
    ['appendMode', null],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = fileDestinationPropertiesSchema.safeParse({ directory: '/out', [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([key]);
  });

  it('rejects a key it does not know, naming it', () => {
    const result = fileDestinationPropertiesSchema.safeParse({ directory: '/out', fileNameTemplate: 'x' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('fileNameTemplate');
  });

  // FILE_DEST_DEFAULTS from 7793c71 (2026-03) to today, with the directory filled.
  it('deploys a destination the editor saved, reading charset UTF-8 as utf-8', () => {
    const saved = { directory: '/out', outputPattern: '${messageId}.txt', charset: 'UTF-8', binary: false, tempFileEnabled: true, appendMode: false };
    expect(fileDestinationPropertiesSchema.parse(saved)).toEqual({ ...saved, charset: 'utf-8' });
  });
});

describe('FILE option lists', () => {
  it('are the orders and actions the receiver implements', () => {
    expect([...FILE_SORT_ORDERS]).toEqual(['NAME', 'DATE', 'SIZE']);
    expect([...FILE_POST_ACTIONS]).toEqual(['DELETE', 'MOVE', 'NONE']);
  });
});
