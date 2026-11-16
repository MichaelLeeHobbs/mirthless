// ===========================================
// Registry: SFTP, DICOM and EMAIL properties parsed by the core-models schemas
// ===========================================

import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

const LOGIN = { host: 'sftp.example', username: 'lab', password: 'p', remoteDirectory: '/in', hostKey: 'ssh-ed25519 AAAA' };

describe('registry SFTP factories', () => {
  // SFTP_*_DEFAULTS since 419d616 (2026-07-12), charset since 5dfea2b, the login filled.
  it('build from the properties the editor saves', () => {
    expect(() => createSourceConnector('SFTP', {
      ...LOGIN, port: 22, privateKey: '', passphrase: '', filePattern: '*', pollingIntervalMs: 5000, afterProcessing: 'DELETE',
      moveToDirectory: '', minFileAgeMs: 1000, charset: 'utf-8', strictHostKey: true,
    })).not.toThrow();
    expect(() => createDestinationConnector('SFTP', {
      ...LOGIN, port: 22, privateKey: '', passphrase: '', fileNameTemplate: '${messageId}.dat', appendMode: false, strictHostKey: true,
    })).not.toThrow();
  });

  it('refuse a key of another connector type, naming it', () => {
    expect(() => createSourceConnector('SFTP', { ...LOGIN, fileFilter: '*.hl7' })).toThrow(/SFTP properties are invalid: .*fileFilter/);
    expect(() => createDestinationConnector('SFTP', { ...LOGIN, outputPattern: 'x' })).toThrow(/outputPattern/);
  });
});

describe('registry DICOM factories', () => {
  // DICOM_*_DEFAULTS since 4349bf4 (2026-03-02), the storage directory filled.
  it('build from the properties the editor saves', () => {
    expect(() => createSourceConnector('DICOM', {
      port: 4242, storageDir: '/in', aeTitle: 'GALVANIGRAPH', minPoolSize: 2, maxPoolSize: 10, connectionTimeoutMs: 10000,
      dispatchMode: 'PER_FILE', postAction: 'DELETE', moveToDirectory: '',
    })).not.toThrow();
    expect(() => createDestinationConnector('DICOM', {
      host: 'localhost', port: 104, calledAETitle: 'PACS', callingAETitle: 'GALVANIGRAPH', mode: 'multiple', maxAssociations: 4,
      maxRetries: 3, retryDelayMs: 1000, timeoutMs: 30000,
    })).not.toThrow();
  });

  // Before it mapped DICOM (#171), the importer copied every Mirth DICOM property, with the values as text.
  it('build an imported sender, its Mirth keys dropped', () => {
    expect(() => createDestinationConnector('DICOM', {
      pluginProperties: '', destinationConnectorProperties: {}, host: 'pacs', port: '104', applicationEntity: 'PACS1', template: '${DICOMMESSAGE}', tls: 'notls',
    })).not.toThrow();
  });

  it('refuse an AE title longer than 16 characters, naming the key', () => {
    expect(() => createDestinationConnector('DICOM', { host: 'pacs', port: 104, calledAETitle: 'SEVENTEEN_CHARS_X' })).toThrow(/calledAETitle/);
  });
});

describe('registry EMAIL factory', () => {
  // EMAIL_SOURCE_DEFAULTS since dad3da5 (2026-03-03), the login filled.
  it('builds from the properties the editor saves', () => {
    expect(() => createSourceConnector('EMAIL', {
      host: 'imap.example', port: 993, secure: true, username: 'lab', password: 'p', protocol: 'IMAP', folder: 'INBOX',
      pollingIntervalMs: 60000, postAction: 'MARK_READ', moveToFolder: '', subjectFilter: '', includeAttachments: false,
    })).not.toThrow();
  });

  it('refuses POP3 and a switch stored as text, naming the key', () => {
    expect(() => createSourceConnector('EMAIL', { host: 'h', username: 'u', password: 'p', protocol: 'POP3' })).toThrow(/protocol/);
    expect(() => createSourceConnector('EMAIL', { host: 'h', username: 'u', password: 'p', secure: 'false' })).toThrow(/secure/);
  });
});
