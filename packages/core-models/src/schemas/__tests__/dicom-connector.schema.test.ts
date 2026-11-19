import { describe, it, expect } from 'vitest';
import {
  dicomSourcePropertiesSchema,
  dicomDestinationPropertiesSchema,
} from '../dicom-connector.schema.js';

// DICOM_SOURCE_DEFAULTS / DICOM_DEST_DEFAULTS as the editor saves them now.
const SOURCE_SAVED = {
  port: 4242, storageDir: '/dicom/in', aeTitle: 'MIRTHLESS', connectionTimeoutMs: 10000,
  dispatchMode: 'PER_FILE', postAction: 'DELETE', moveToDirectory: '',
};
const DEST_SAVED = {
  host: 'localhost', port: 104, calledAETitle: 'PACS', callingAETitle: 'MIRTHLESS',
  maxRetries: 3, retryDelayMs: 1000, timeoutMs: 30000,
};
// What the editor saved from 4349bf4 (2026-03-02) until #154: settings the connector never read.
const SOURCE_SAVED_BEFORE_154 = { ...SOURCE_SAVED, minPoolSize: 2, maxPoolSize: 10 };
const DEST_SAVED_BEFORE_154 = { ...DEST_SAVED, mode: 'multiple', maxAssociations: 4 };

/** A few of the Mirth DICOM Listener properties the importer copied before it mapped DICOM (#171). */
const MIRTH_LISTENER = {
  pluginProperties: '', listenerConnectorProperties: { host: '0.0.0.0', port: '104' }, sourceConnectorProperties: { responseVariable: 'None' },
  applicationEntity: 'MIRTH', localHost: '', localPort: '', dest: '/mirth/dicom', tls: 'notls', keyStorePW: '', reaper: '10', bufSize: '1',
};
const MIRTH_SENDER = {
  pluginProperties: '', destinationConnectorProperties: { queueEnabled: 'false' }, applicationEntity: 'PACS1', localApplicationEntity: '',
  priority: 'med', stgcmt: 'false', ts1: 'false', username: '', passcode: '', tls: 'notls', trustStorePW: '',
};

describe('dicomSourcePropertiesSchema', () => {
  it('accepts what the editor saves, as it is', () => {
    expect(dicomSourcePropertiesSchema.parse(SOURCE_SAVED)).toEqual(SOURCE_SAVED);
  });

  it('needs a port and a storage directory, and fills the rest', () => {
    expect(dicomSourcePropertiesSchema.parse({ port: '4242', storageDir: '/in' })).toEqual({
      port: 4242, storageDir: '/in', aeTitle: 'GALVANIGRAPH', connectionTimeoutMs: 10000,
      dispatchMode: 'PER_FILE', postAction: 'DELETE', moveToDirectory: '',
    });
  });

  // #154: the pool sizes were checked but never used; a channel saved with them still deploys.
  it('drops the pool sizes a channel saved before #154 carries, whatever their values', () => {
    expect(dicomSourcePropertiesSchema.parse(SOURCE_SAVED_BEFORE_154)).toEqual(SOURCE_SAVED);
    expect(dicomSourcePropertiesSchema.parse({ ...SOURCE_SAVED, minPoolSize: 5, maxPoolSize: 4 })).toEqual(SOURCE_SAVED);
  });

  // The importer has copied a DICOM Listener's Mirth properties since 2026-03-03; once the form's port and directory are filled it deploys.
  it("drops the Mirth keys the importer copies and nothing reads", () => {
    expect(dicomSourcePropertiesSchema.parse({ ...MIRTH_LISTENER, ...SOURCE_SAVED })).toEqual(SOURCE_SAVED);
  });

  it.each([
    ['port', 0],
    ['storageDir', ' '],
    ['aeTitle', 'SEVENTEEN_CHARS_X'],
    ['connectionTimeoutMs', -1],
    ['dispatchMode', 'PER_STUDY'],
    ['postAction', 'ARCHIVE'],
    ['processBatch', 'true'],
    ['aeTitles', 'X'],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = dicomSourcePropertiesSchema.safeParse({ ...SOURCE_SAVED, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });

  it('needs a move-to directory for MOVE', () => {
    const move = dicomSourcePropertiesSchema.safeParse({ ...SOURCE_SAVED, postAction: 'MOVE' });
    expect(move.success ? [] : move.error.issues.map((i) => i.path)).toEqual([['moveToDirectory']]);
  });
});

describe('dicomDestinationPropertiesSchema', () => {
  it('accepts what the editor saves, as it is', () => {
    expect(dicomDestinationPropertiesSchema.parse(DEST_SAVED)).toEqual(DEST_SAVED);
  });

  // #154: the send mode and association limit were never read; a channel saved with them still deploys.
  it('drops the send mode and association limit a channel saved before #154 carries', () => {
    expect(dicomDestinationPropertiesSchema.parse(DEST_SAVED_BEFORE_154)).toEqual(DEST_SAVED);
    expect(dicomDestinationPropertiesSchema.parse({ ...DEST_SAVED, mode: 'pooled', maxAssociations: -1 })).toEqual(DEST_SAVED);
  });

  // An imported DICOM Sender keeps Mirth's host and port and deploys unedited.
  it('drops the Mirth keys the importer copies, keeping host and port', () => {
    expect(dicomDestinationPropertiesSchema.parse({ ...MIRTH_SENDER, host: 'pacs', port: '104' })).toEqual({
      host: 'pacs', port: 104, calledAETitle: 'PACS', callingAETitle: 'GALVANIGRAPH',
      maxRetries: 3, retryDelayMs: 1000, timeoutMs: 30000,
    });
  });

  // Mirth's DICOM Sender template `${DICOMMESSAGE}` means "the message"; sent as written it is a file path that does not exist.
  it("drops Mirth's ${DICOMMESSAGE} template, so the message itself is sent", () => {
    expect(dicomDestinationPropertiesSchema.parse({ ...DEST_SAVED, template: '${DICOMMESSAGE}' })).toEqual(DEST_SAVED);
    expect(dicomDestinationPropertiesSchema.parse({ ...DEST_SAVED, template: '${message.encodedData}' })).toEqual({ ...DEST_SAVED, template: '${message.encodedData}' });
  });

  // Mirth's DICOM `tls` is `notls` unless TLS is on; this connector has no TLS.
  it.each([['aes'], ['3des'], ['without']])("refuses Mirth's tls = %s, naming the key, instead of sending in plaintext", (tls) => {
    const sender = dicomDestinationPropertiesSchema.safeParse({ ...MIRTH_SENDER, host: 'pacs', port: '104', tls });
    expect(sender.success ? [] : sender.error.issues.map((i) => i.path)).toEqual([['tls']]);
    const listener = dicomSourcePropertiesSchema.safeParse({ ...MIRTH_LISTENER, ...SOURCE_SAVED, tls });
    expect(listener.success ? [] : listener.error.issues.map((i) => i.path)).toEqual([['tls']]);
  });

  it.each([
    ['host', ''],
    ['port', 70000],
    ['calledAETitle', 'SEVENTEEN_CHARS_X'],
    ['callingAETitle', 'SEVENTEEN_CHARS_X'],
    ['maxRetries', -1],
    ['timeoutMs', 2_147_483_648],
    ['template', 3],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = dicomDestinationPropertiesSchema.safeParse({ ...DEST_SAVED, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe(key);
  });
});
