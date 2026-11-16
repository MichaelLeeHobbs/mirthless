// ===========================================
// SFTP Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  sftpSourcePropertiesSchema,
  sftpDestinationPropertiesSchema,
} from '../sftp-connector.schema.js';

const LOGIN = { host: 'sftp.example', username: 'lab', password: 'p', remoteDirectory: '/in', hostKey: 'ssh-ed25519 AAAA' };

// SFTP_SOURCE_DEFAULTS / SFTP_DEST_DEFAULTS since 419d616 (2026-07-12), charset since 5dfea2b (2026-11-11), login filled.
const SOURCE_SAVED = {
  ...LOGIN, port: 22, privateKey: '', passphrase: '', filePattern: '*', pollingIntervalMs: 5000, afterProcessing: 'DELETE',
  moveToDirectory: '', minFileAgeMs: 1000, charset: 'utf-8', strictHostKey: true,
};
const DEST_SAVED = {
  ...LOGIN, port: 22, privateKey: '', passphrase: '', fileNameTemplate: '${messageId}.dat', appendMode: false, strictHostKey: true,
};

describe('sftpSourcePropertiesSchema', () => {
  it('accepts what the editor saves, as it is', () => {
    expect(sftpSourcePropertiesSchema.parse(SOURCE_SAVED)).toEqual(SOURCE_SAVED);
  });

  // What the importer writes for a Mirth File Reader with the sftp scheme (0ebf4d2, 2026-11-13).
  it('accepts an imported reader and fills the defaults', () => {
    const imported = { host: 'h', remoteDirectory: '/in', username: 'u', password: 'p', strictHostKey: false, port: '2222', filePattern: '*.hl7', afterProcessing: 'MOVE', moveToDirectory: '/done', pollingIntervalMs: 500, processBatch: true };
    expect(sftpSourcePropertiesSchema.parse(imported)).toMatchObject({ port: 2222, charset: 'utf-8', minFileAgeMs: 1000 });
  });

  it('accepts a private key instead of a password, and no host key with checking off', () => {
    expect(sftpSourcePropertiesSchema.safeParse({ host: 'h', username: 'u', privateKey: 'KEY', remoteDirectory: '/in', strictHostKey: false }).success).toBe(true);
  });

  it.each([
    [{ ...SOURCE_SAVED, password: '', privateKey: '' }, 'password'],
    [{ ...SOURCE_SAVED, hostKey: ' ' }, 'hostKey'],
    [{ ...SOURCE_SAVED, afterProcessing: 'MOVE' }, 'moveToDirectory'],
    [{ ...SOURCE_SAVED, filePattern: '' }, 'filePattern'],
    [{ ...SOURCE_SAVED, pollingIntervalMs: 50 }, 'pollingIntervalMs'],
    [{ ...SOURCE_SAVED, charset: 'base64' }, 'charset'],
    [{ ...SOURCE_SAVED, strictHostKey: 'false' }, 'strictHostKey'],
    [{ ...SOURCE_SAVED, fileFilter: '*' }, 'fileFilter'],
    [{ ...SOURCE_SAVED, host: '' }, 'host'],
  ])('rejects %j, naming %s', (props, key) => {
    const result = sftpSourcePropertiesSchema.safeParse(props);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});

describe('sftpDestinationPropertiesSchema', () => {
  it('accepts what the editor saves, as it is', () => {
    expect(sftpDestinationPropertiesSchema.parse(DEST_SAVED)).toEqual(DEST_SAVED);
  });

  it('accepts an imported writer with a template', () => {
    expect(sftpDestinationPropertiesSchema.safeParse({ ...LOGIN, fileNameTemplate: 'x.hl7', appendMode: true, template: '${message.encodedData}' }).success).toBe(true);
  });

  it.each([
    [{ ...DEST_SAVED, fileNameTemplate: '' }, 'fileNameTemplate'],
    [{ ...DEST_SAVED, appendMode: 'true' }, 'appendMode'],
    [{ ...DEST_SAVED, outputPattern: 'x' }, 'outputPattern'],
    [{ ...DEST_SAVED, port: 0 }, 'port'],
  ])('rejects %j, naming %s', (props, key) => {
    const result = sftpDestinationPropertiesSchema.safeParse(props);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});
