// ===========================================
// Connector direction validation (#109)
// ===========================================
// A channel's source must be a type that can receive, and each destination a
// type that can send. SMTP and FHIR only send; EMAIL only receives. Saving one in
// the wrong direction used to pass validation and fail at deploy.

import { describe, it, expect } from 'vitest';
import { createChannelSchema, updateChannelSchema, destinationInputSchema } from '../channel.schema.js';
import { channelExportEntrySchema } from '../channel-export.schema.js';
import { SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '../../constants.js';

const SEND_ONLY = ['SMTP', 'FHIR'] as const;
const RECEIVE_ONLY = ['EMAIL'] as const;

function channel(sourceConnectorType: string): Record<string, unknown> {
  return {
    name: 'c',
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType,
    sourceConnectorProperties: {},
  };
}

function destination(connectorType: string): Record<string, unknown> {
  return { name: 'd', connectorType, properties: {} };
}

const exportSource = channelExportEntrySchema.shape.sourceConnectorType;
const exportDestinationType = channelExportEntrySchema.shape.destinations.element.shape.connectorType;

describe('channel source connector type', () => {
  it.each(SEND_ONLY)('rejects %s as a source when a channel is created', (type) => {
    expect(createChannelSchema.safeParse(channel(type)).success).toBe(false);
  });

  it.each(SEND_ONLY)('rejects %s as a source when a channel is updated', (type) => {
    expect(updateChannelSchema.safeParse({ revision: 1, sourceConnectorType: type }).success).toBe(false);
  });

  it.each(SEND_ONLY)('rejects %s as a source in an imported channel', (type) => {
    expect(exportSource.safeParse(type).success).toBe(false);
  });

  it('accepts every source type everywhere a source is named', () => {
    for (const type of SOURCE_CONNECTOR_TYPES) {
      expect(createChannelSchema.safeParse(channel(type)).success, type).toBe(true);
      expect(updateChannelSchema.safeParse({ revision: 1, sourceConnectorType: type }).success, type).toBe(true);
      expect(exportSource.safeParse(type).success, type).toBe(true);
    }
  });

  it('rejects a type that is not a connector at all in an imported channel', () => {
    expect(exportSource.safeParse('FTP').success).toBe(false);
  });
});

describe('channel destination connector type', () => {
  it.each(RECEIVE_ONLY)('rejects %s as a destination', (type) => {
    expect(destinationInputSchema.safeParse(destination(type)).success).toBe(false);
    expect(exportDestinationType.safeParse(type).success).toBe(false);
  });

  it('accepts every destination type everywhere a destination is named', () => {
    for (const type of DESTINATION_CONNECTOR_TYPES) {
      expect(destinationInputSchema.safeParse(destination(type)).success, type).toBe(true);
      expect(exportDestinationType.safeParse(type).success, type).toBe(true);
    }
  });
});
