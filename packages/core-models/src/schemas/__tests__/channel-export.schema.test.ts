// ===========================================
// Channel Import Schema Tests
// ===========================================
// Import writes channels straight to the database, so it must refuse a
// connector type the registry cannot build in that position (#109).

import { describe, it, expect } from 'vitest';
import { channelImportSchema } from '../channel-export.schema.js';
import { SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '../channel.schema.js';

function destination(connectorType: string, metaDataId = 1): Record<string, unknown> {
  return {
    metaDataId, name: `Dest ${connectorType}`, enabled: true, connectorType, properties: {},
    queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10_000, rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
  };
}

/** A channel as the export service writes it. */
function entry(sourceConnectorType: string, destinations: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    name: `Channel ${sourceConnectorType}`, description: null, enabled: true, revision: 1,
    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
    sourceConnectorType, sourceConnectorProperties: {},
    responseMode: 'AUTO_AFTER_DESTINATIONS', responseConnectorName: null,
    initialState: 'STARTED', messageStorageMode: 'DEVELOPMENT', encryptData: false,
    removeContentOnCompletion: false, removeAttachmentsOnCompletion: false,
    pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false,
    scripts: [], destinations, metadataColumns: [], filters: [], transformers: [],
  };
}

function importFile(channels: ReadonlyArray<Record<string, unknown>>): unknown {
  return { version: 1, exportedAt: '2026-11-15T00:00:00.000Z', channels, collisionMode: 'SKIP' };
}

describe('channelImportSchema connector types', () => {
  it('imports an export using every real source and destination type', () => {
    const destinations = DESTINATION_CONNECTOR_TYPES.map((t, i) => destination(t, i + 1));
    const channels = SOURCE_CONNECTOR_TYPES.map((t) => entry(t, destinations));
    const result = channelImportSchema.safeParse(importFile(channels));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each(['SMTP', 'FHIR'])('refuses a channel whose source is the destination-only %s', (type) => {
    expect(channelImportSchema.safeParse(importFile([entry(type, [])])).success).toBe(false);
  });

  it('refuses a destination of the source-only type EMAIL', () => {
    expect(channelImportSchema.safeParse(importFile([entry('TCP_MLLP', [destination('EMAIL')])])).success).toBe(false);
  });
});
