// ===========================================
// Connector Defaults Tests (SFTP + response transformer)
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  SFTP_SOURCE_DEFAULTS,
  getDefaultProperties,
} from '../source/connector-defaults.js';
import {
  SFTP_DEST_DEFAULTS,
  getDestDefaultProperties,
  createDefaultDestination,
} from '../destinations/connector-defaults.js';

// Exact keys the SFTP connectors read — must not drift.
const SFTP_SOURCE_KEYS = [
  'host', 'port', 'username', 'password', 'privateKey', 'passphrase',
  'remoteDirectory', 'filePattern', 'pollingIntervalMs', 'afterProcessing',
  'moveToDirectory', 'minFileAgeMs', 'strictHostKey', 'hostKey',
];

const SFTP_DEST_KEYS = [
  'host', 'port', 'username', 'password', 'privateKey', 'passphrase',
  'remoteDirectory', 'fileNameTemplate', 'appendMode', 'strictHostKey', 'hostKey',
];

describe('SFTP source defaults', () => {
  it('exposes exactly the connector property keys', () => {
    expect(Object.keys(SFTP_SOURCE_DEFAULTS).sort()).toEqual([...SFTP_SOURCE_KEYS].sort());
  });

  it('uses the documented defaults', () => {
    expect(SFTP_SOURCE_DEFAULTS['port']).toBe(22);
    expect(SFTP_SOURCE_DEFAULTS['filePattern']).toBe('*');
    expect(SFTP_SOURCE_DEFAULTS['pollingIntervalMs']).toBe(5000);
    expect(SFTP_SOURCE_DEFAULTS['afterProcessing']).toBe('DELETE');
    expect(SFTP_SOURCE_DEFAULTS['minFileAgeMs']).toBe(1000);
    expect(SFTP_SOURCE_DEFAULTS['strictHostKey']).toBe(true);
  });

  it('is resolvable via getDefaultProperties', () => {
    expect(getDefaultProperties('SFTP')).toEqual(SFTP_SOURCE_DEFAULTS);
  });
});

describe('SFTP destination defaults', () => {
  it('exposes exactly the connector property keys', () => {
    expect(Object.keys(SFTP_DEST_DEFAULTS).sort()).toEqual([...SFTP_DEST_KEYS].sort());
  });

  it('uses the documented defaults', () => {
    expect(SFTP_DEST_DEFAULTS['port']).toBe(22);
    expect(SFTP_DEST_DEFAULTS['fileNameTemplate']).toBe('${messageId}.dat');
    expect(SFTP_DEST_DEFAULTS['appendMode']).toBe(false);
    expect(SFTP_DEST_DEFAULTS['strictHostKey']).toBe(true);
  });

  it('is resolvable via getDestDefaultProperties', () => {
    expect(getDestDefaultProperties('SFTP')).toEqual(SFTP_DEST_DEFAULTS);
  });
});

describe('createDefaultDestination', () => {
  it('includes an empty response transformer script', () => {
    const dest = createDefaultDestination(0);
    expect(dest.responseTransformer).toBe('');
  });
});
