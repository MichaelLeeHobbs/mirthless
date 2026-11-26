// Import writes channels straight to the database, so it must refuse a
// connector type the registry cannot build in that position (#109).

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import { channelImportSchema } from '../channel-export.schema.js';
import { channelPropertiesSchema } from '../channel.schema.js';
import { SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '../../constants.js';

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

  it('names the channel and the type in the message the client gets, not only the array index', () => {
    const good = entry('TCP_MLLP', []);
    const bad = { ...entry('SMTP', []), name: 'Lab Results Out' };
    const result = channelImportSchema.safeParse(importFile([good, bad]));
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = z.prettifyError(result.error);
    expect(message).toContain('Channel "Lab Results Out"');
    expect(message).toContain('SMTP');
  });

  it('names the channel and destination for a bad destination type', () => {
    const bad = { ...entry('TCP_MLLP', [{ ...destination('EMAIL'), name: 'To Mailbox' }]), name: 'Orders' };
    const result = channelImportSchema.safeParse(importFile([bad]));
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = z.prettifyError(result.error);
    expect(message).toContain('Channel "Orders"');
    expect(message).toContain('destination "To Mailbox"');
    expect(message).toContain('EMAIL');
  });
});

// The pruner deletes what is older: with 0 or less that is every finished message (#202).
describe('channelImportSchema pruning age', () => {
  const parses = (pruningMaxAgeDays: unknown): boolean => channelImportSchema.safeParse(importFile([{ ...entry('TCP_MLLP', []), pruningMaxAgeDays }])).success;

  it.each([null, 1, 365])('takes what the channel API takes: %s', (days) => { expect(parses(days)).toBe(true); });
  it.each([0, -1, 0.5, '7'])('refuses what it refuses: %s', (days) => { expect(parses(days)).toBe(false); });
});

describe('channelImportSchema script timeout', () => {
  const importedTimeout = (fields: Record<string, unknown>): number | undefined => {
    const result = channelImportSchema.safeParse(importFile([{ ...entry('TCP_MLLP', []), ...fields }]));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    return result.data?.channels[0]?.scriptTimeoutSeconds;
  };

  it.each([1, 120, 300])('keeps %s seconds', (scriptTimeoutSeconds) => {
    expect(importedTimeout({ scriptTimeoutSeconds })).toBe(scriptTimeoutSeconds);
  });

  it('is absent from a file exported before it was included', () => {
    expect(importedTimeout({})).toBeUndefined();
  });

  it.each([0, -1, 301, 15.5, '60', null])('refuses %j, as the channel API does', (scriptTimeoutSeconds) => {
    expect(channelPropertiesSchema.safeParse({ scriptTimeoutSeconds }).success).toBe(false);
    expect(channelImportSchema.safeParse(importFile([{ ...entry('TCP_MLLP', []), scriptTimeoutSeconds }])).success).toBe(false);
  });
});

describe('channelImportSchema script languages', () => {
  it('reads an unknown language as JavaScript, as stored rows do, instead of refusing the whole file', () => {
    const channel = { ...entry('TCP_MLLP', []), scripts: [{ scriptType: 'DEPLOY', script: 'x', language: 'PYTHON' }, { scriptType: 'UNDEPLOY', script: 'y', language: 'TYPESCRIPT' }, { scriptType: 'PREPROCESSOR', script: 'z' }] };
    const result = channelImportSchema.safeParse(importFile([channel]));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.channels[0]!.scripts.map((s) => s.language)).toEqual(['JAVASCRIPT', 'TYPESCRIPT', undefined]);
  });
});
