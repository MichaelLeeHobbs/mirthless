// ===========================================
// Registry: CHANNEL, FHIR and SMTP properties parsed by the core-models schemas
// ===========================================

import { describe, it, expect } from 'vitest';
import { createSourceConnector, createDestinationConnector } from '../registry.js';

describe('registry CHANNEL factories', () => {
  // CHANNEL_*_DEFAULTS since 45fad27 (2026-03), with the id deploy sets and a target picked.
  it('build from the properties the editor saves', () => {
    expect(() => createSourceConnector('CHANNEL', { channelId: 'c1' })).not.toThrow();
    expect(() => createDestinationConnector('CHANNEL', { targetChannelId: 'c2', waitForResponse: false })).not.toThrow();
  });

  // The Mirth importer copied all of a Channel Reader's or Writer's properties from 2026-03-03 to 2026-11-12.
  it('build an old import, its Mirth keys dropped', () => {
    expect(() => createSourceConnector('CHANNEL', { channelId: 'c1', pluginProperties: '', sourceConnectorProperties: {} })).not.toThrow();
    expect(() => createDestinationConnector('CHANNEL', {
      targetChannelId: 'c2', pluginProperties: '', destinationConnectorProperties: {}, channelId: 'c2', channelTemplate: '${message.encodedData}', mapVariables: '',
    })).not.toThrow();
  });

  it('refuse a misspelled key or a switch stored as text, naming it', () => {
    expect(() => createDestinationConnector('CHANNEL', { targetChannelId: 'c2', waitForReply: true })).toThrow(/CHANNEL properties are invalid: .*waitForReply/);
    expect(() => createDestinationConnector('CHANNEL', { targetChannelId: 'c2', waitForResponse: 'false' })).toThrow(/waitForResponse/);
    expect(() => createSourceConnector('CHANNEL', {})).toThrow(/channelId/);
  });
});

describe('registry FHIR factory', () => {
  // FHIR_DEST_DEFAULTS since 349a666 (2026-07-12), and the 2026-03 to 2026-07 form's text headers.
  it('builds from the properties the editor saves, old and new', () => {
    const saved = {
      baseUrl: 'https://fhir.example/r4', resourceType: 'Patient', method: 'POST', authType: 'NONE', authUsername: '', authPassword: '',
      authToken: '', authHeaderName: '', authApiKey: '', format: 'json', timeout: 30000,
    };
    expect(() => createDestinationConnector('FHIR', { ...saved, headers: {} })).not.toThrow();
    expect(() => createDestinationConnector('FHIR', { ...saved, headers: 'X-Site: LAB' })).not.toThrow();
  });

  it('refuses an auth type missing its credential, or an unknown one, naming the key', () => {
    expect(() => createDestinationConnector('FHIR', { baseUrl: 'https://f/r4', authType: 'BEARER' })).toThrow(/authToken/);
    expect(() => createDestinationConnector('FHIR', { baseUrl: 'https://f/r4', authType: 'OAUTH' })).toThrow(/authType/);
  });
});

describe('registry SMTP factory', () => {
  // SMTP_DEST_DEFAULTS since db4e6fd (2026-07-15), required fields filled, a blank attachment row.
  it('builds from the properties the editor saves', () => {
    expect(() => createDestinationConnector('SMTP', {
      host: 'mail', port: 587, secure: false, requireTLS: false, authUser: '', authPass: '', from: 'a@x', to: 'b@x', cc: '', bcc: '',
      subject: '', bodyTemplate: '${msg}', contentType: 'text/plain', attachContent: false, attachments: [{ filename: '', mimeType: '', content: '' }],
    })).not.toThrow();
  });

  it('builds with a port from a resolved configuration reference', () => {
    expect(() => createDestinationConnector('SMTP', { host: 'mail', port: '25', from: 'a@x', to: 'b@x' })).not.toThrow();
  });

  it('refuses an attachment of the wrong shape instead of skipping it', () => {
    expect(() => createDestinationConnector('SMTP', { host: 'mail', from: 'a@x', to: 'b@x', attachments: [{ filename: 'a.txt' }] })).toThrow(/attachments/);
  });
});
