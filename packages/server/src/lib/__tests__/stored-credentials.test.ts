// D-335: an OVERWRITE import keeps a stored credential only for a connector
// that still goes to the same place as the same user.

import { describe, it, expect } from 'vitest';
import {
  SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES, type SourceConnectorType, type DestinationConnectorType,
  tcpMllpSourceObjectSchema, tcpMllpDestinationObjectSchema, httpSourceObjectSchema, httpDestinationObjectSchema,
  fileSourceObjectSchema, fileDestinationObjectSchema, databaseSourceObjectSchema, databaseDestinationObjectSchema,
  javascriptSourceObjectSchema, javascriptDestinationObjectSchema, channelSourceObjectSchema, channelDestinationObjectSchema,
  dicomSourceObjectSchema, dicomDestinationObjectSchema, emailSourceObjectSchema, smtpDestinationObjectSchema,
  fhirDestinationObjectSchema, sftpSourceObjectSchema, sftpDestinationObjectSchema, kafkaSourceObjectSchema,
  kafkaDestinationObjectSchema, amqpSourcePropertiesSchema, amqpDestinationPropertiesSchema,
} from '@galvanigraph/core-models';
import { CONNECTOR_KEYS, overwriteProperties, sameDestination, type ConnectorDirection, type ConnectorKeys } from '../stored-credentials.js';
import { REDACTED, isSecretPropertyKey, redactConnectorProperties } from '../secret-redaction.js';

const SOURCE_SHAPES: Readonly<Record<SourceConnectorType, object>> = {
  TCP_MLLP: tcpMllpSourceObjectSchema.shape,
  HTTP: httpSourceObjectSchema.shape,
  FILE: fileSourceObjectSchema.shape,
  DATABASE: databaseSourceObjectSchema.shape,
  JAVASCRIPT: javascriptSourceObjectSchema.shape,
  CHANNEL: channelSourceObjectSchema.shape,
  DICOM: dicomSourceObjectSchema.shape,
  EMAIL: emailSourceObjectSchema.shape,
  SFTP: sftpSourceObjectSchema.shape,
  KAFKA: kafkaSourceObjectSchema.shape,
  AMQP: amqpSourcePropertiesSchema.shape,
};

const DESTINATION_SHAPES: Readonly<Record<DestinationConnectorType, object>> = {
  TCP_MLLP: tcpMllpDestinationObjectSchema.shape,
  HTTP: httpDestinationObjectSchema.shape,
  FILE: fileDestinationObjectSchema.shape,
  DATABASE: databaseDestinationObjectSchema.shape,
  JAVASCRIPT: javascriptDestinationObjectSchema.shape,
  SMTP: smtpDestinationObjectSchema.shape,
  CHANNEL: channelDestinationObjectSchema.shape,
  FHIR: fhirDestinationObjectSchema.shape,
  DICOM: dicomDestinationObjectSchema.shape,
  SFTP: sftpDestinationObjectSchema.shape,
  KAFKA: kafkaDestinationObjectSchema.shape,
  AMQP: amqpDestinationPropertiesSchema.shape,
};

// Written out, not read from the table, so a key that leaves the deciding list fails here.
const SOURCE_MUST_DECIDE: Readonly<Record<SourceConnectorType, readonly string[]>> = {
  TCP_MLLP: ['host', 'port', 'tls'],
  HTTP: ['host', 'port', 'path', 'matchSubpaths', 'auth', 'scheme', 'tls'],
  FILE: [
    'directory', 'fileFilter', 'ignoreDot', 'pollingIntervalMs', 'sortBy', 'charset', 'binary', 'checkFileAge', 'fileAgeMs',
    'postAction', 'moveToDirectory', 'processBatch',
  ],
  DATABASE: ['vendor', 'host', 'port', 'database', 'username', 'tls'],
  JAVASCRIPT: ['script', 'scriptLanguage', 'pollingIntervalMs', 'processBatch'],
  CHANNEL: ['channelId', 'processBatch'],
  DICOM: ['port', 'storageDir', 'aeTitle', 'connectionTimeoutMs', 'dispatchMode', 'postAction', 'moveToDirectory', 'processBatch'],
  EMAIL: ['host', 'port', 'secure', 'username', 'protocol'],
  SFTP: ['host', 'port', 'username', 'strictHostKey', 'hostKey'],
  KAFKA: ['brokers', 'clientId', 'useTls', 'tls', 'saslMechanism', 'saslUsername'],
  AMQP: ['host', 'port', 'vhost', 'username', 'useTls', 'tls'],
};

const DESTINATION_MUST_DECIDE: Readonly<Record<DestinationConnectorType, readonly string[]>> = {
  TCP_MLLP: ['host', 'port', 'tls'],
  HTTP: ['url', 'parameters', 'headers', 'basicAuth', 'scheme', 'tls'],
  FILE: ['directory', 'outputPattern', 'charset', 'binary', 'tempFileEnabled', 'appendMode', 'template'],
  DATABASE: ['vendor', 'host', 'port', 'database', 'username', 'tls'],
  JAVASCRIPT: ['script', 'scriptLanguage', 'template'],
  SMTP: ['host', 'port', 'secure', 'requireTLS', 'authUser'],
  CHANNEL: ['targetChannelId', 'waitForResponse', 'template'],
  FHIR: ['baseUrl', 'resourceType', 'authType', 'authUsername', 'authHeaderName', 'headers'],
  DICOM: ['host', 'port', 'calledAETitle', 'callingAETitle', 'maxRetries', 'retryDelayMs', 'timeoutMs', 'template'],
  SFTP: ['host', 'port', 'username', 'strictHostKey', 'hostKey'],
  KAFKA: ['brokers', 'clientId', 'useTls', 'tls', 'saslMechanism', 'saslUsername', 'topic'],
  AMQP: ['host', 'port', 'vhost', 'username', 'useTls', 'tls', 'exchange', 'routingKey', 'headers'],
};

type Row = readonly [
  label: string, direction: ConnectorDirection, type: string, keys: ConnectorKeys, shape: object, mustDecide: readonly string[],
];

const ROWS: readonly Row[] = [
  ...SOURCE_CONNECTOR_TYPES.map((t): Row => [`${t} source`, 'source', t, CONNECTOR_KEYS.source[t], SOURCE_SHAPES[t], SOURCE_MUST_DECIDE[t]]),
  ...DESTINATION_CONNECTOR_TYPES.map((t): Row => [
    `${t} destination`, 'destination', t, CONNECTOR_KEYS.destination[t], DESTINATION_SHAPES[t], DESTINATION_MUST_DECIDE[t],
  ]),
];

/**
 * Every key set, with one secret under a key no schema has so that a type with
 * no credential of its own is covered too.
 */
function storedProperties(keys: ConnectorKeys): Record<string, unknown> {
  const all = [...keys.deciding, ...keys.free, ...keys.credentials];
  return { ...Object.fromEntries(all.map((key) => [key, `stored ${key}`])), probe: { token: 'stored probe' } };
}

function secretsIn(properties: Readonly<Record<string, unknown>>, keys: ConnectorKeys): readonly unknown[] {
  return [...keys.credentials.map((key) => properties[key]), (properties['probe'] as { token?: unknown }).token];
}

describe.each(ROWS)('the stored credentials of a %s', (_label, direction, connectorType, keys, shape, mustDecide) => {
  const stored = storedProperties(keys);
  const exported = redactConnectorProperties(stored);
  const overwrite = (properties: Record<string, unknown>, from: Record<string, unknown> = stored): Record<string, unknown> =>
    overwriteProperties(direction, { connectorType, properties }, { connectorType, properties: from });
  const none = [...keys.credentials.map(() => undefined), undefined];

  it('has every property of its schema in one list', () => {
    expect([...keys.deciding, ...keys.free, ...keys.credentials].sort()).toEqual(Object.keys(shape).sort());
  });

  it('lists as a credential only what an export masks, and nothing an export masks as free', () => {
    expect(keys.credentials.filter((key) => !isSecretPropertyKey(key))).toEqual([]);
    expect(keys.free.filter(isSecretPropertyKey)).toEqual([]);
  });

  it('are kept when the file changes nothing, or only free settings', () => {
    expect(overwrite(exported)).toEqual(stored);
    const changes = Object.fromEntries(keys.free.map((key) => [key, 'changed']));
    expect(overwrite({ ...exported, ...changes })).toEqual({ ...stored, ...changes });
  });

  it('has no more and no fewer deciding settings than are written out here', () => {
    expect([...keys.deciding].sort()).toEqual([...mustDecide].sort());
  });

  it('are dropped when any deciding setting is changed, missing from the file or new in it', () => {
    for (const key of mustDecide) {
      expect(secretsIn(overwrite({ ...exported, [key]: 'changed' }), keys), key).toEqual(none);
      const { [key]: _absent, ...fewer } = exported;
      expect(secretsIn(overwrite(fewer), keys), key).toEqual(none);
      const { [key]: _unset, ...older } = stored;
      expect(secretsIn(overwrite(exported, older), keys), key).toEqual(none);
    }
  });

  it('are dropped when a setting the table does not know is changed, missing from the file or new in it', () => {
    // One named like a secret counts too: an export masks it, so a file that holds it in clear changed it.
    for (const key of ['notInTheTable', 'tokenUrl']) {
      const before = { ...stored, [key]: 'a' };
      const file = redactConnectorProperties(before);
      expect(overwrite(file, before), key).toEqual(before);
      expect(secretsIn(overwrite({ ...file, [key]: 'b' }, before), keys), key).toEqual(none);
      expect(secretsIn(overwrite({ ...exported, [key]: 'b' }), keys), key).toEqual(none);
      expect(secretsIn(overwrite(exported, before), keys), key).toEqual(none);
    }
  });

  it('are dropped when the connector is new or its type changed', () => {
    expect(secretsIn(overwriteProperties(direction, { connectorType, properties: exported }, undefined), keys)).toEqual(none);
    const others = ROWS.filter((row) => row[1] === direction && row[2] !== connectorType).map((row) => row[2]);
    for (const other of others) {
      expect(secretsIn(overwriteProperties(direction, { connectorType, properties: exported }, { connectorType: other, properties: stored }), keys), other).toEqual(none);
    }
  });
});

describe('sameDestination', () => {
  const at = (metaDataId: number, name: string): { readonly metaDataId: number; readonly name: string } => ({ metaDataId, name });
  const file = [at(1, 'A'), at(2, 'B')];

  it('is the stored one with the same metaDataId and the same name', () => {
    const stored = [at(2, 'B'), at(1, 'A')];
    expect(sameDestination(file[0]!, file, stored)).toBe(stored[1]);
    expect(sameDestination(file[1]!, file, stored)).toBe(stored[0]);
  });

  it.each([
    ['they were reordered', file, [at(1, 'B'), at(2, 'A')]],
    ['one was deleted and the other renumbered', file, [at(1, 'B')]],
    ['it was renamed', file, [at(1, 'a'), at(2, 'B ')]],
    ['it is new', file, []],
    ['another stored one has its name', file, [at(1, 'A'), at(2, 'B'), at(3, 'A'), at(4, 'B')]],
    ['another in the file has its name', [...file, at(3, 'A'), at(4, 'B')], [at(1, 'A'), at(2, 'B')]],
  ])('is none when %s', (_what, inFile, stored) => {
    expect(sameDestination(at(1, 'A'), inFile, stored)).toBeUndefined();
    expect(sameDestination(at(2, 'B'), inFile, stored)).toBeUndefined();
  });
});

describe('overwriteProperties', () => {
  const http = {
    url: 'https://api.example.org/in', method: 'POST',
    headers: { Accept: 'application/json', Authorization: 'Bearer abc', 'X-API-Key': 'k' },
    basicAuth: { username: 'svc', password: 'pw' },
    tls: { caCertId: '', clientCertId: '', rejectUnauthorized: true },
  };
  const overHttp = (changes: Record<string, unknown>): Record<string, unknown> => overwriteProperties(
    'destination',
    { connectorType: 'HTTP', properties: { ...redactConnectorProperties(http), ...changes } },
    { connectorType: 'HTTP', properties: http },
  );

  it('keeps nested credentials', () => {
    expect(overHttp({ method: 'PUT' })).toEqual({ ...http, method: 'PUT' });
  });

  it.each([
    ['a header that is not a secret', { headers: { Accept: 'text/plain', Authorization: REDACTED, 'X-API-Key': REDACTED } }],
    ['a header left out', { headers: { Authorization: REDACTED, 'X-API-Key': REDACTED } }],
    ['certificate verification', { tls: { caCertId: '', clientCertId: '', rejectUnauthorized: false } }],
    ['a number written as text', { tls: { caCertId: '', clientCertId: '', rejectUnauthorized: 'true' } }],
    ['one of two nested secrets', { headers: { Accept: 'application/json', Authorization: 'Bearer mine', 'X-API-Key': REDACTED } }],
  ])('drops every masked credential of the connector when the file changes %s', (_what, changes) => {
    const out = overHttp(changes);
    expect(JSON.stringify(out)).not.toMatch(/abc|"k"|"pw"|__REDACTED__/);
    expect(out['url']).toBe(http.url);
  });

  it('does not count a masked header the target never had', () => {
    const headers = { ...redactConnectorProperties(http.headers), Cookie: REDACTED };
    expect(overHttp({ headers })).toEqual(http);
  });

  it('lets the file set one credential and keep another', () => {
    const sftp = { host: 'h', port: 22, username: 'u', password: 'p', privateKey: 'k', passphrase: 's', remoteDirectory: '/', strictHostKey: true, hostKey: 'fp' };
    const file = { ...redactConnectorProperties(sftp), password: 'rotated' };
    const out = overwriteProperties('source', { connectorType: 'SFTP', properties: file }, { connectorType: 'SFTP', properties: sftp });
    expect(out).toEqual({ ...sftp, password: 'rotated' });
  });

  it('gives a masked credential the target has no value for nothing', () => {
    const stored = { host: 'h', port: 5432, database: 'd', username: 'u', password: '', query: 'q' };
    const out = overwriteProperties('destination', { connectorType: 'DATABASE', properties: { ...stored, password: REDACTED } }, { connectorType: 'DATABASE', properties: stored });
    expect(out).toEqual({ host: 'h', port: 5432, database: 'd', username: 'u', query: 'q' });
  });

  it('keeps nothing for a type this version does not know, or one that cannot run in that direction', () => {
    for (const [direction, connectorType] of [['source', 'FTP'], ['source', 'SMTP'], ['destination', 'EMAIL'], ['destination', 'constructor']] as const) {
      const out = overwriteProperties(direction, { connectorType, properties: { password: REDACTED } }, { connectorType, properties: { password: 'p' } });
      expect(out, connectorType).toEqual({});
    }
  });

  it('keeps nothing when the stored properties are not an object', () => {
    expect(overwriteProperties('source', { connectorType: 'EMAIL', properties: { password: REDACTED } }, { connectorType: 'EMAIL', properties: null })).toEqual({});
  });
});
