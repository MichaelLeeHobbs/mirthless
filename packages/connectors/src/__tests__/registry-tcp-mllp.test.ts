// ===========================================
// Registry: TCP/MLLP properties parsed by the core-models schema
// ===========================================

import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

describe('registry TCP_MLLP factories', () => {
  it('build from the properties the editor saves, a text port included', () => {
    expect(() => createSourceConnector('TCP_MLLP', { host: '0.0.0.0', port: '6661', charset: 'latin1', responseMode: 'PASSTHROUGH' })).not.toThrow();
    expect(() => createDestinationConnector('TCP_MLLP', { host: 'lis', port: 6661, frameStart: '02', frameEnd: '03', template: 'x' })).not.toThrow();
  });

  it('refuse a misspelled key instead of ignoring it', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, maxConnection: 5 })).toThrow(/maxConnection/);
    expect(() => createDestinationConnector('TCP_MLLP', { host: 'lis', port: 6661, responseTimout: 5 })).toThrow(/responseTimout/);
  });

  it('refuse a charset the connector does not support', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, charset: 'windows-1252' })).toThrow(/charset/);
  });

  it('build a channel the 2026-02 to 2026-07 editor saved, old keys and charset spelling included', () => {
    expect(() => createSourceConnector('TCP_MLLP', {
      host: '0.0.0.0', port: 6661, maxConnections: 10, receiveTimeout: 0, bufferSize: 65536,
      keepConnectionOpen: true, charset: 'ISO-8859-1', transmissionMode: 'MLLP',
    })).not.toThrow();
  });

  it('refuse a destination with no host', () => {
    expect(() => createDestinationConnector('TCP_MLLP', { port: 6661 })).toThrow(/host/);
  });

  it('still refuse half a TLS key pair, with the TLS message', () => {
    expect(() => createSourceConnector('TCP_MLLP', { port: 6661, tls: { cert: 'PEM' } })).toThrow(/tls\.key/);
  });
});
