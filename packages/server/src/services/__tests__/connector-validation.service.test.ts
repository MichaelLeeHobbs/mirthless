// ===========================================
// Connector Validation Service Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { CONNECTOR_TYPES } from '@galvaniflow/core-models';
import { createSourceConnector, createDestinationConnector } from '@galvaniflow/connectors';
import { validateConnectorProperties } from '../connector-validation.service.js';

describe('validateConnectorProperties: Kafka and AMQP', () => {
  it('accepts valid Kafka and AMQP properties as saved, with certificate ids in tls', () => {
    const tls = { caCertId: 'ca-1', clientCertId: '', rejectUnauthorized: true };
    expect(validateConnectorProperties('KAFKA', 'source', { brokers: 'k:9093', topic: 't', groupId: 'g', useTls: true, tls }).ok).toBe(true);
    expect(validateConnectorProperties('KAFKA', 'destination', { brokers: 'k:9093', topic: 'out-${site}' }).ok).toBe(true);
    expect(validateConnectorProperties('AMQP', 'source', { host: 'rabbit', queue: 'q', useTls: true, tls }).ok).toBe(true);
    expect(validateConnectorProperties('AMQP', 'destination', { host: 'rabbit', routingKey: 'q' }).ok).toBe(true);
  });

  it('rejects a Kafka source with no consumer group, naming the field', () => {
    const result = validateConnectorProperties('KAFKA', 'source', { brokers: 'k:9092', topic: 't' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('groupId');
  });

  it('rejects an AMQP source with no queue', () => {
    expect(validateConnectorProperties('AMQP', 'source', { host: 'rabbit' }).ok).toBe(false);
  });
});

// ----- Source Connectors -----

describe('validateConnectorProperties', () => {
  describe('source connectors', () => {
    it('accepts valid TCP_MLLP source properties', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 6661 });
      expect(result.ok).toBe(true);
    });

    it('rejects TCP_MLLP source with missing port', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('port');
    });

    it('rejects TCP_MLLP source with port out of range (0)', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 0 });
      expect(result.ok).toBe(false);
    });

    it('rejects TCP_MLLP source with port out of range (65536)', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 65536 });
      expect(result.ok).toBe(false);
    });

    it('accepts valid HTTP source properties', () => {
      const result = validateConnectorProperties('HTTP', 'source', { port: 8080 });
      expect(result.ok).toBe(true);
    });

    it('rejects HTTP source with missing port', () => {
      const result = validateConnectorProperties('HTTP', 'source', {});
      expect(result.ok).toBe(false);
    });

    it('accepts valid FILE source properties', () => {
      const result = validateConnectorProperties('FILE', 'source', { directory: '/data/in' });
      expect(result.ok).toBe(true);
    });

    it('rejects FILE source with empty directory', () => {
      const result = validateConnectorProperties('FILE', 'source', { directory: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('directory');
    });

    it('accepts valid DATABASE source properties', () => {
      const result = validateConnectorProperties('DATABASE', 'source', {
        host: 'localhost', port: 5432, database: 'mydb', selectQuery: 'SELECT 1',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DATABASE source with missing host', () => {
      const result = validateConnectorProperties('DATABASE', 'source', {
        port: 5432, database: 'mydb', selectQuery: 'SELECT 1',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('accepts valid JAVASCRIPT source properties', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'source', { script: 'return "ok";' });
      expect(result.ok).toBe(true);
    });

    it('rejects JAVASCRIPT source with empty script', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'source', { script: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('script');
    });

    it('accepts valid CHANNEL source properties', () => {
      const result = validateConnectorProperties('CHANNEL', 'source', { channelId: 'abc-123' });
      expect(result.ok).toBe(true);
    });

    it('rejects CHANNEL source with empty channelId', () => {
      const result = validateConnectorProperties('CHANNEL', 'source', { channelId: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('channelId');
    });

    it('accepts valid DICOM source properties', () => {
      const result = validateConnectorProperties('DICOM', 'source', {
        port: 4242, storageDir: '/data/dicom',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DICOM source with missing storageDir', () => {
      const result = validateConnectorProperties('DICOM', 'source', { port: 4242 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('storageDir');
    });

    it('rejects DICOM source with invalid port', () => {
      const result = validateConnectorProperties('DICOM', 'source', { port: 0, storageDir: '/data' });
      expect(result.ok).toBe(false);
    });

    it('rejects a TCP_MLLP key the schema does not list, naming it', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 6661, maxConnection: 5 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('maxConnection');
    });

    it('rejects a TCP_MLLP charset the connector does not support', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', { port: 6661, charset: 'windows-1252' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('charset:');
    });

    it('accepts a TCP_MLLP channel the 2026-02 to 2026-07 editor saved', () => {
      const source = { host: '0.0.0.0', port: 6661, maxConnections: 10, receiveTimeout: 0, bufferSize: 65536, keepConnectionOpen: true, charset: 'UTF-8', transmissionMode: 'MLLP' };
      const dest = { host: 'localhost', port: 6661, sendTimeout: 10000, keepConnectionOpen: true, charset: 'UTF-8', transmissionMode: 'MLLP', bufferSize: 65536 };
      expect(validateConnectorProperties('TCP_MLLP', 'source', source).ok).toBe(true);
      expect(validateConnectorProperties('TCP_MLLP', 'destination', dest).ok).toBe(true);
    });

    it('rejects an HTTP key the schema does not list, naming it', () => {
      const result = validateConnectorProperties('HTTP', 'source', { port: 8080, responseStatus: 202 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('responseStatus');
    });

    it('rejects an HTTP source path that a request could never match', () => {
      const result = validateConnectorProperties('HTTP', 'source', { port: 8080, path: 'api' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('path: must start with /');
    });

    it('accepts HTTP channels the 2026-02 to 2026-07 editor saved', () => {
      const source = { host: '0.0.0.0', port: 8080, contextPath: '/', methods: ['POST'], responseStatusCode: 200, responseContentType: 'text/plain', charset: 'UTF-8' };
      const dest = { url: 'http://localhost:8080', method: 'POST', headers: '', contentType: 'text/plain', charset: 'UTF-8', responseTimeout: 30000 };
      const pemDest = { url: 'http://localhost:8080', method: 'POST', headers: {}, contentType: 'text/plain', responseTimeout: 30000, tls: { ca: '', cert: '', key: '', rejectUnauthorized: true } };
      expect(validateConnectorProperties('HTTP', 'source', source).ok).toBe(true);
      expect(validateConnectorProperties('HTTP', 'destination', dest).ok).toBe(true);
      expect(validateConnectorProperties('HTTP', 'destination', pemDest).ok).toBe(true);
    });

    it('accepts the keys the engine reads from every HTTP connector', () => {
      expect(validateConnectorProperties('HTTP', 'source', { port: 8080, processBatch: true }).ok).toBe(true);
      expect(validateConnectorProperties('HTTP', 'destination', { url: 'http://lis', template: 'x' }).ok).toBe(true);
    });

    // DATABASE defaults from 7793c71 (2026-03) until 73d0a87 (2026-11) added `tls`, with the required fields filled.
    it('accepts DATABASE channels the editor saved before tls existed', () => {
      const connection = { host: 'localhost', port: 5432, database: 'lab', username: '', password: '' };
      expect(validateConnectorProperties('DATABASE', 'source', {
        ...connection, selectQuery: 'SELECT 1', updateQuery: '', updateMode: 'NEVER', pollingIntervalMs: 5000, rowFormat: 'JSON',
      }).ok).toBe(true);
      expect(validateConnectorProperties('DATABASE', 'destination', {
        ...connection, query: 'INSERT INTO t VALUES (1)', useTransaction: false, returnGeneratedKeys: false,
      }).ok).toBe(true);
    });

    it('accepts a DATABASE connector with no port, which then uses the vendor default', () => {
      expect(validateConnectorProperties('DATABASE', 'source', { vendor: 'mysql', host: 'db', database: 'lab', selectQuery: 'SELECT 1' }).ok).toBe(true);
    });

    it('rejects a DATABASE key it does not know, naming it', () => {
      const result = validateConnectorProperties('DATABASE', 'source', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', url: 'jdbc:postgresql://db/lab' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('url');
    });

    it('rejects a DATABASE source that would update rows with no update query', () => {
      const result = validateConnectorProperties('DATABASE', 'source', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', updateMode: 'ON_SUCCESS' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('updateQuery: required when updateMode is ON_SUCCESS');
    });

    it('rejects a DATABASE source polling faster than the receiver allows', () => {
      const result = validateConnectorProperties('DATABASE', 'source', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', pollingIntervalMs: 50 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('pollingIntervalMs');
    });

    it('accepts the keys the engine reads from every DATABASE connector', () => {
      expect(validateConnectorProperties('DATABASE', 'source', { host: 'db', database: 'lab', selectQuery: 'SELECT 1', processBatch: true }).ok).toBe(true);
      expect(validateConnectorProperties('DATABASE', 'destination', { host: 'db', database: 'lab', query: 'SELECT 1', template: 'x' }).ok).toBe(true);
    });

    it('accepts the keys the engine reads from every TCP_MLLP connector', () => {
      expect(validateConnectorProperties('TCP_MLLP', 'source', { port: 6661, processBatch: true }).ok).toBe(true);
      expect(validateConnectorProperties('TCP_MLLP', 'destination', { host: 'lis', port: 6661, template: 'x' }).ok).toBe(true);
    });
  });

  // ----- Destination Connectors -----

  describe('destination connectors', () => {
    it('accepts valid TCP_MLLP destination properties', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'destination', {
        host: 'remote-host', port: 6661,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects TCP_MLLP destination with missing host', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'destination', { port: 6661 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('accepts valid HTTP destination properties', () => {
      const result = validateConnectorProperties('HTTP', 'destination', {
        url: 'http://example.com/api',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects HTTP destination with empty url', () => {
      const result = validateConnectorProperties('HTTP', 'destination', { url: '' });
      expect(result.ok).toBe(false);
    });

    it('accepts valid FILE destination properties', () => {
      const result = validateConnectorProperties('FILE', 'destination', { directory: '/data/out' });
      expect(result.ok).toBe(true);
    });

    it('rejects FILE destination with missing directory', () => {
      const result = validateConnectorProperties('FILE', 'destination', {});
      expect(result.ok).toBe(false);
    });

    it('accepts valid DATABASE destination properties', () => {
      const result = validateConnectorProperties('DATABASE', 'destination', {
        host: 'localhost', port: 5432, database: 'mydb', query: 'INSERT INTO t VALUES ($1)',
      });
      expect(result.ok).toBe(true);
    });

    it('accepts a MySQL database and refuses one with no driver, naming it', () => {
      const props = { host: 'localhost', port: 3306, database: 'mydb', query: 'INSERT INTO t VALUES (1)' };
      expect(validateConnectorProperties('DATABASE', 'destination', { ...props, vendor: 'mysql' }).ok).toBe(true);
      const refused = validateConnectorProperties('DATABASE', 'destination', { ...props, vendor: 'sqlserver' });
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.message).toContain('database "sqlserver" is not supported');
      const source = validateConnectorProperties('DATABASE', 'source', { host: 'h', port: 1, database: 'd', selectQuery: 'SELECT 1', vendor: 'oracle' });
      expect(!source.ok && source.error.message).toContain('database "oracle" is not supported');
    });

    it('rejects DATABASE destination with missing query', () => {
      const result = validateConnectorProperties('DATABASE', 'destination', {
        host: 'localhost', port: 5432, database: 'mydb',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('query');
    });

    it('accepts valid JAVASCRIPT destination properties', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'destination', { script: 'return msg;' });
      expect(result.ok).toBe(true);
    });

    it('rejects JAVASCRIPT destination with empty script', () => {
      const result = validateConnectorProperties('JAVASCRIPT', 'destination', { script: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('script');
    });

    it('accepts valid SMTP destination properties', () => {
      const result = validateConnectorProperties('SMTP', 'destination', {
        host: 'smtp.example.com', port: 587, to: 'admin@example.com',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects SMTP destination with missing to', () => {
      const result = validateConnectorProperties('SMTP', 'destination', {
        host: 'smtp.example.com', port: 587,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('to');
    });

    it('accepts valid CHANNEL destination properties', () => {
      const result = validateConnectorProperties('CHANNEL', 'destination', {
        targetChannelId: 'target-abc-123',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects CHANNEL destination with empty targetChannelId', () => {
      const result = validateConnectorProperties('CHANNEL', 'destination', { targetChannelId: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('targetChannelId');
    });

    it('accepts valid FHIR destination properties', () => {
      const result = validateConnectorProperties('FHIR', 'destination', {
        baseUrl: 'https://fhir.example.com/r4',
      });
      expect(result.ok).toBe(true);
    });

    it('rejects FHIR destination with empty baseUrl', () => {
      const result = validateConnectorProperties('FHIR', 'destination', { baseUrl: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('baseUrl');
    });

    it('accepts valid DICOM destination properties', () => {
      const result = validateConnectorProperties('DICOM', 'destination', {
        host: '192.168.1.100', port: 104,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects DICOM destination with missing host', () => {
      const result = validateConnectorProperties('DICOM', 'destination', { port: 104 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
    });

    it('rejects DICOM destination with invalid port', () => {
      const result = validateConnectorProperties('DICOM', 'destination', { host: 'pacs.local', port: 0 });
      expect(result.ok).toBe(false);
    });
  });

  // ----- Unknown Type -----

  describe('unknown connector type', () => {
    it('rejects an unknown source connector type, naming it', () => {
      const result = validateConnectorProperties('UNKNOWN_TYPE', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
      expect(result.error.message).toContain('Unknown source connector type: UNKNOWN_TYPE');
    });

    it('rejects an unknown destination connector type', () => {
      const result = validateConnectorProperties('FUTURE_CONNECTOR', 'destination', { foo: 'bar' });
      expect(result.ok).toBe(false);
    });

    it('does not take an object prototype key for a connector type', () => {
      expect(validateConnectorProperties('constructor', 'source', {}).ok).toBe(false);
    });

    it('rejects a destination-only type as a source and a source-only type as a destination', () => {
      expect(validateConnectorProperties('SMTP', 'source', { host: 'mail', port: 25, to: 'a@b' }).ok).toBe(false);
      expect(validateConnectorProperties('EMAIL', 'destination', { host: 'mail', port: 993, username: 'u', password: 'p' }).ok).toBe(false);
    });
  });

  describe('every registry connector type has a schema', () => {
    /** Types the connector registry can build in a mode (a factory that rejects empty properties still counts). */
    function registryTypes(create: (type: string, props: Record<string, unknown>) => unknown): string[] {
      return CONNECTOR_TYPES.filter((type) => {
        try {
          create(type, {});
          return true;
        } catch (err: unknown) {
          return !(err instanceof Error && err.message.startsWith('Unknown'));
        }
      });
    }

    /** Types validation knows in a mode: anything not refused as unknown. */
    function validatedTypes(mode: 'source' | 'destination'): string[] {
      return CONNECTOR_TYPES.filter((type) => {
        const result = validateConnectorProperties(type, mode, {});
        return result.ok || !result.error.message.startsWith('Unknown');
      });
    }

    it('validates exactly the source types the registry builds', () => {
      expect(validatedTypes('source')).toEqual(registryTypes(createSourceConnector));
    });

    it('validates exactly the destination types the registry builds', () => {
      expect(validatedTypes('destination')).toEqual(registryTypes(createDestinationConnector));
    });
  });

  describe('SFTP', () => {
    // As the SFTP source and destination forms save them (web connector-defaults), filled in.
    const SFTP_SOURCE = {
      host: 'sftp.lab.example', port: 22, username: 'lab', password: 'pw', privateKey: '', passphrase: '',
      remoteDirectory: '/inbound', filePattern: '*', pollingIntervalMs: 5000, afterProcessing: 'DELETE',
      moveToDirectory: '', minFileAgeMs: 1000, charset: 'utf-8', strictHostKey: true, hostKey: 'AAAAkey',
    };
    const SFTP_DEST = {
      host: 'sftp.lab.example', port: 22, username: 'lab', password: '', privateKey: '-----BEGIN KEY-----', passphrase: '',
      remoteDirectory: '/outbound', fileNameTemplate: '${messageId}.dat', appendMode: false, strictHostKey: true, hostKey: 'AAAAkey',
    };

    it('accepts SFTP source and destination properties as the forms save them', () => {
      expect(validateConnectorProperties('SFTP', 'source', SFTP_SOURCE).ok).toBe(true);
      expect(validateConnectorProperties('SFTP', 'destination', SFTP_DEST).ok).toBe(true);
    });

    it('accepts a missing port (the connector uses 22) and no host key when host key checking is off', () => {
      const { port: _port, ...noPort } = SFTP_SOURCE;
      expect(validateConnectorProperties('SFTP', 'source', { ...noPort, strictHostKey: false, hostKey: '' }).ok).toBe(true);
    });

    it('rejects an SFTP source with no host and a non-numeric port, naming both', () => {
      const result = validateConnectorProperties('SFTP', 'source', { port: 'abc' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('host');
      expect(result.error.message).toContain('port');
    });

    it.each([['source', SFTP_SOURCE], ['destination', SFTP_DEST]] as const)('rejects an SFTP %s with neither password nor private key', (mode, props) => {
      const result = validateConnectorProperties('SFTP', mode, { ...props, password: '', privateKey: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('password or a privateKey');
    });

    it.each([['source', SFTP_SOURCE], ['destination', SFTP_DEST]] as const)('rejects an SFTP %s that checks the host key but has none', (mode, props) => {
      const { hostKey: _hostKey, ...noKey } = props;
      const result = validateConnectorProperties('SFTP', mode, noKey);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('hostKey');
    });

    it('rejects an SFTP source that moves processed files but names no directory, or has an unknown action', () => {
      expect(validateConnectorProperties('SFTP', 'source', { ...SFTP_SOURCE, afterProcessing: 'MOVE', moveToDirectory: '' }).ok).toBe(false);
      expect(validateConnectorProperties('SFTP', 'source', { ...SFTP_SOURCE, afterProcessing: 'MOVE', moveToDirectory: '/done' }).ok).toBe(true);
      expect(validateConnectorProperties('SFTP', 'source', { ...SFTP_SOURCE, afterProcessing: 'ARCHIVE' }).ok).toBe(false);
    });

    it.each(['username', 'remoteDirectory'])('rejects an SFTP destination with an empty %s', (key) => {
      expect(validateConnectorProperties('SFTP', 'destination', { ...SFTP_DEST, [key]: '' }).ok).toBe(false);
    });
  });

  // ----- Error Message Format -----

  describe('error messages', () => {
    it('includes connector type and mode in error message', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('source');
      expect(result.error.message).toContain('TCP_MLLP');
    });

    it('includes INVALID_INPUT error code', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'source', {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
    });
  });

  describe('ports given as text', () => {
    it('accepts digits as text, as a resolved configuration reference gives them', () => {
      expect(validateConnectorProperties('TCP_MLLP', 'destination', { host: 'lis', port: '6661' }).ok).toBe(true);
    });

    it.each([[true], ['66a'], ['']])('refuses %j as a port', (port) => {
      expect(validateConnectorProperties('TCP_MLLP', 'source', { port }).ok).toBe(false);
    });

    it('says a configuration reference that did not resolve is the problem', () => {
      const result = validateConnectorProperties('TCP_MLLP', 'destination', { host: 'lis', port: '${MIRTH_SENDER_PORT}' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('configuration map reference ${MIRTH_SENDER_PORT} did not resolve');
    });
  });
});
