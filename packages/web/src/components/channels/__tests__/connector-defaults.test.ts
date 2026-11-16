/// <reference types="node" />
// ===========================================
// Connector Defaults Tests (SFTP + response transformer)
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  SFTP_SOURCE_DEFAULTS,
  HTTP_SOURCE_DEFAULTS,
  TCP_MLLP_SOURCE_DEFAULTS,
  DATABASE_SOURCE_DEFAULTS,
  FILE_SOURCE_DEFAULTS,
  JAVASCRIPT_SOURCE_DEFAULTS,
  getDefaultProperties,
} from '../source/connector-defaults.js';
import {
  SFTP_DEST_DEFAULTS,
  HTTP_DEST_DEFAULTS,
  TCP_MLLP_DEST_DEFAULTS,
  DATABASE_DEST_DEFAULTS,
  FILE_DEST_DEFAULTS,
  JAVASCRIPT_DEST_DEFAULTS,
  SMTP_DEST_DEFAULTS,
  getDestDefaultProperties,
  createDefaultDestination,
} from '../destinations/connector-defaults.js';
import { MLLP_RESPONSE_MODES } from '../source/tcp-mllp-options.js';
import { CHARSET_OPTIONS } from '../common/charset-options.js';
import {
  tcpMllpSourcePropertiesSchema,
  tcpMllpDestinationPropertiesSchema,
  CONNECTOR_CHARSETS,
  TCP_MLLP_RESPONSE_MODES,
  fileSourcePropertiesSchema,
  fileDestinationPropertiesSchema,
  javascriptSourcePropertiesSchema,
  javascriptDestinationPropertiesSchema,
  httpSourcePropertiesSchema,
  httpDestinationPropertiesSchema,
  databaseSourcePropertiesSchema,
  databaseDestinationPropertiesSchema,
  DATABASE_VENDORS,
} from '@galvaniflow/core-models';
import { DATABASE_VENDOR_OPTIONS } from '../common/DatabaseVendorField.js';

// Exact keys the SFTP connectors read — must not drift.
const SFTP_SOURCE_KEYS = [
  'host', 'port', 'username', 'password', 'privateKey', 'passphrase',
  'remoteDirectory', 'filePattern', 'pollingIntervalMs', 'afterProcessing',
  'moveToDirectory', 'minFileAgeMs', 'strictHostKey', 'hostKey', 'charset',
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

describe('HTTP TLS defaults (id-based, no raw PEM)', () => {
  it('destination defaults to HTTP with an id-based client tls bag', () => {
    expect(HTTP_DEST_DEFAULTS['scheme']).toBe('HTTP');
    const tls = HTTP_DEST_DEFAULTS['tls'] as Record<string, unknown>;
    expect(Object.keys(tls).sort()).toEqual(['caCertId', 'clientCertId', 'rejectUnauthorized']);
    expect(tls['rejectUnauthorized']).toBe(true);
    // Hard cut — no raw PEM keys leak into defaults.
    expect(tls['ca']).toBeUndefined();
    expect(tls['cert']).toBeUndefined();
    expect(tls['key']).toBeUndefined();
  });

  it('source defaults to HTTP with an id-based server tls bag', () => {
    expect(HTTP_SOURCE_DEFAULTS['scheme']).toBe('HTTP');
    const tls = HTTP_SOURCE_DEFAULTS['tls'] as Record<string, unknown>;
    expect(Object.keys(tls).sort()).toEqual(['caCertId', 'requireClientCert', 'serverCertId']);
    expect(tls['requireClientCert']).toBe(false);
    expect(tls['cert']).toBeUndefined();
    expect(tls['key']).toBeUndefined();
  });
});

describe('TCP/MLLP defaults match the core-models schema', () => {
  // The schema returns the defaults unchanged: it rejects unknown keys, and
  // it would add any defaulted key the form left out.
  it.each([
    ['source', tcpMllpSourcePropertiesSchema, TCP_MLLP_SOURCE_DEFAULTS],
    ['destination', tcpMllpDestinationPropertiesSchema, TCP_MLLP_DEST_DEFAULTS],
  ] as const)('%s', (_name, schema, defaults) => {
    expect(schema.parse(defaults)).toEqual(defaults);
  });

  it('the form offers exactly the schema response modes', () => {
    expect(MLLP_RESPONSE_MODES.map((o) => o.value)).toEqual([...TCP_MLLP_RESPONSE_MODES]);
  });
});

describe('the charset field', () => {
  it('offers exactly the charsets the TCP/MLLP and FILE schemas accept', () => {
    expect(CHARSET_OPTIONS.map((o) => o.value)).toEqual([...CONNECTOR_CHARSETS]);
  });
});

describe('FILE defaults match the core-models schema', () => {
  // The schema returns the defaults unchanged once the directory a user must
  // fill in is set: it rejects unknown keys, and it would add any defaulted
  // key the form left out.
  it.each([
    ['source', fileSourcePropertiesSchema, { ...FILE_SOURCE_DEFAULTS, directory: '/in' }],
    ['destination', fileDestinationPropertiesSchema, { ...FILE_DEST_DEFAULTS, directory: '/out' }],
  ] as const)('%s', (_name, schema, filled) => {
    expect(schema.parse(filled)).toEqual(filled);
  });
});

describe('JAVASCRIPT defaults match the core-models schema', () => {
  // The schema returns the defaults unchanged once the script a user must
  // write is set: it rejects unknown keys and a blank script, and it would add
  // any defaulted key the form left out.
  it.each([
    ['source', javascriptSourcePropertiesSchema, { ...JAVASCRIPT_SOURCE_DEFAULTS, script: 'return "x";' }],
    ['destination', javascriptDestinationPropertiesSchema, { ...JAVASCRIPT_DEST_DEFAULTS, script: 'return msg;' }],
  ] as const)('%s', (_name, schema, filled) => {
    expect(schema.parse(filled)).toEqual(filled);
  });
});

describe('HTTP defaults match the core-models schema', () => {
  // The schema returns the defaults unchanged: it rejects unknown keys, and
  // it would add any defaulted key the form left out.
  it.each([
    ['source', httpSourcePropertiesSchema, HTTP_SOURCE_DEFAULTS],
    ['destination', httpDestinationPropertiesSchema, HTTP_DEST_DEFAULTS],
  ] as const)('%s', (_name, schema, defaults) => {
    expect(schema.parse(defaults)).toEqual(defaults);
  });
});

describe('DATABASE defaults match the core-models schema', () => {
  // The schema returns the defaults unchanged once the fields a user must
  // fill in are set: it rejects unknown keys, and it would add any defaulted
  // key the form left out. `vendor` and `port` stay as the form saves them.
  it.each([
    ['source', databaseSourcePropertiesSchema, { ...DATABASE_SOURCE_DEFAULTS, database: 'lab', selectQuery: 'SELECT 1' }],
    ['destination', databaseDestinationPropertiesSchema, { ...DATABASE_DEST_DEFAULTS, database: 'lab', query: 'SELECT 1' }],
  ] as const)('%s', (_name, schema, filled) => {
    expect(schema.parse(filled)).toEqual(filled);
  });

  it('the vendor field offers exactly the schema vendors', () => {
    expect(DATABASE_VENDOR_OPTIONS.map((o) => o.value)).toEqual([...DATABASE_VENDORS]);
  });
});

describe('HTTP source runtime option defaults (rank-4 surfacing)', () => {
  it('surfaces errorStatusCode/maxBodyBytes with safe defaults', () => {
    expect(HTTP_SOURCE_DEFAULTS['errorStatusCode']).toBe(500);
    expect(HTTP_SOURCE_DEFAULTS['maxBodyBytes']).toBe(52428800);
  });
});

describe('SMTP dest runtime option defaults (rank-4 surfacing)', () => {
  it('surfaces requireTLS defaulting to false', () => {
    expect(SMTP_DEST_DEFAULTS['requireTLS']).toBe(false);
  });

  it('defaults attachments to an empty array (rank-9 multi-attachment)', () => {
    expect(SMTP_DEST_DEFAULTS['attachments']).toEqual([]);
  });
});

describe('createDefaultDestination', () => {
  it('includes an empty response transformer script', () => {
    const dest = createDefaultDestination(0);
    expect(dest.responseTransformer).toBe('');
  });
});
