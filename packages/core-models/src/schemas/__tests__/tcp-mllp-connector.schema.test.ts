// ===========================================
// TCP/MLLP Connector Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  tcpMllpSourcePropertiesSchema,
  tcpMllpDestinationPropertiesSchema,
} from '../tcp-mllp-connector.schema.js';

const CERT = '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';

describe('tcpMllpSourcePropertiesSchema', () => {
  it('needs only a port and fills the defaults', () => {
    expect(tcpMllpSourcePropertiesSchema.parse({ port: 6661 })).toEqual({
      host: '0.0.0.0',
      port: 6661,
      maxConnections: 10,
      responseMode: 'AUTO_ACK',
      charset: 'utf-8',
      maxFrameBytes: 52_428_800,
    });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      host: '127.0.0.1', port: '6661', maxConnections: 2, responseMode: 'PASSTHROUGH', charset: 'latin1',
      maxFrameBytes: 1024, frameStart: '02', frameEnd: '03', processBatch: true,
      tls: { cert: CERT, key: KEY, ca: CERT, requireClientCert: true },
    };
    expect(tcpMllpSourcePropertiesSchema.parse(all)).toEqual({ ...all, port: 6661 });
  });

  it('rejects a missing port', () => {
    expect(tcpMllpSourcePropertiesSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    ['maxConnections', 'ten'],
    ['responseMode', 'ACK'],
    ['charset', 'ISO-8859-1'],
    ['maxFrameBytes', 0],
    ['frameStart', 2],
    ['tls', 'yes'],
    ['tls', { cert: CERT, key: KEY, requireClientCert: 'yes' }],
  ])('rejects %s = %j', (key, value) => {
    expect(tcpMllpSourcePropertiesSchema.safeParse({ port: 6661, [key]: value }).success).toBe(false);
  });

  it('rejects a key it does not know, so a misspelling fails instead of being ignored', () => {
    const result = tcpMllpSourcePropertiesSchema.safeParse({ port: 6661, maxConnection: 5 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('maxConnection');
  });

  it('rejects an unknown key inside tls', () => {
    expect(tcpMllpSourcePropertiesSchema.safeParse({ port: 6661, tls: { certificate: CERT, key: KEY } }).success).toBe(false);
  });

  it('accepts tls switched off as false or null', () => {
    expect(tcpMllpSourcePropertiesSchema.parse({ port: 6661, tls: false }).tls).toBe(false);
    expect(tcpMllpSourcePropertiesSchema.parse({ port: 6661, tls: null }).tls).toBeNull();
  });
});

describe('tcpMllpDestinationPropertiesSchema', () => {
  it('needs a host and a port and fills the defaults', () => {
    expect(tcpMllpDestinationPropertiesSchema.parse({ host: 'lis', port: 6661 })).toEqual({
      host: 'lis',
      port: 6661,
      maxConnections: 5,
      responseTimeout: 30_000,
      acquireTimeoutMs: 30_000,
      charset: 'utf-8',
    });
  });

  it('accepts every key the connector reads', () => {
    const all = {
      host: 'lis', port: 6661, maxConnections: 1, responseTimeout: 5000, acquireTimeoutMs: 1000, charset: 'utf16le',
      frameStart: '0B', frameEnd: '1C0D', template: '${message.encodedData}',
      tls: { cert: CERT, key: KEY, ca: CERT, rejectUnauthorized: false },
    };
    expect(tcpMllpDestinationPropertiesSchema.parse(all)).toEqual(all);
  });

  it.each([
    [{ port: 6661 }],
    [{ host: '', port: 6661 }],
    [{ host: 'lis' }],
    [{ host: 'lis', port: 6661, responseTimeout: '30s' }],
    [{ host: 'lis', port: 6661, tls: { rejectUnauthorized: 'no' } }],
    [{ host: 'lis', port: 6661, remotePort: 6661 }],
  ])('rejects %j', (props) => {
    expect(tcpMllpDestinationPropertiesSchema.safeParse(props).success).toBe(false);
  });
});
