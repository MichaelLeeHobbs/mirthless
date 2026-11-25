// Ids are lower case from the boundary on (D-349). What a miss did is in
// packages/server/test/integration/id-case.itest.ts.

import { describe, it, expect } from 'vitest';
import { createChannelId, channelIdSchema } from '../../brands.js';
import { channelImportSchema } from '../channel-export.schema.js';
import { collectionRecordIdSchema } from '../collection.schema.js';
import { crossChannelSearchQuerySchema } from '../cross-channel-search.schema.js';
import { idSchema } from '../id.schema.js';
import { serverRestoreInputSchema } from '../server-backup.schema.js';

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const same = (id: string): string => id;
const caps = (id: string): string => id.toUpperCase();

describe('idSchema', () => {
  it.each([A, caps(A), `${A.slice(0, 18)}${caps(A).slice(18)}`])('reads %s as the stored id', (id) => {
    expect(idSchema.parse(id)).toBe(A);
  });

  it.each(['', 'me', `{${A}}`, A.replace(/-/g, ''), ` ${A}`, 7, null, undefined])('refuses %s', (id) => {
    expect(idSchema.safeParse(id).success).toBe(false);
  });
});

describe('a branded id', () => {
  it('is the stored id, whichever way it is made', () => {
    expect(createChannelId(caps(A))).toBe(A);
    expect(channelIdSchema.parse(caps(A))).toBe(A);
    expect(() => createChannelId('me')).toThrow('Invalid ChannelId');
  });
});

describe('collectionRecordIdSchema', () => {
  it('reads an id in capitals as the stored id, and names the record id when it is not one', () => {
    expect(collectionRecordIdSchema.parse(caps(A))).toBe(A);
    expect(collectionRecordIdSchema.safeParse('x').error?.issues.map((i) => i.message)).toEqual(['record id must be a UUID']);
  });
});

describe('crossChannelSearchQuerySchema', () => {
  it('reads its channel ids as stored', () => {
    expect(crossChannelSearchQuerySchema.parse({ channelIds: `${caps(A)},${B}` }).channelIds).toBe(`${A},${B}`);
    expect(crossChannelSearchQuerySchema.parse({}).channelIds).toBeUndefined();
  });
});

function channelEntry(write: (id: string) => string): Record<string, unknown> {
  return {
    id: write(A), name: 'C', description: null, enabled: true, revision: 1, inboundDataType: 'RAW', outboundDataType: 'RAW',
    sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: {}, responseMode: 'NONE', responseConnectorName: null,
    initialState: 'STOPPED', messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false,
    removeAttachmentsOnCompletion: false, pruningEnabled: false, pruningMaxAgeDays: null, pruningArchiveEnabled: false,
    scripts: [], destinations: [], metadataColumns: [], filters: [], transformers: [],
  };
}

function importFile(write: (id: string) => string): Record<string, unknown> {
  return { version: 1, exportedAt: 'x', channels: [channelEntry(write)], collisionMode: 'SKIP', groupId: write(B) };
}

function restoreFile(write: (id: string) => string): Record<string, unknown> {
  const a = write(A);
  const b = write(B);
  return {
    collisionMode: 'SKIP',
    backup: {
      version: 1, exportedAt: 'x', channels: [channelEntry(write)],
      codeTemplateLibraries: [{ id: a, name: 'L', description: null, channelIds: [a, b] }],
      codeTemplates: [{ id: a, libraryId: b, name: 'T', description: null, type: 'FUNCTION', code: '', contexts: [] }],
      alerts: [{
        id: a, name: 'A', description: null, enabled: true, trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
        channelIds: [b], actions: [], subjectTemplate: null, bodyTemplate: null, reAlertIntervalMs: null, maxAlerts: null,
      }],
      globalScripts: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' },
      users: [{ id: a, username: 'u', email: 'u@example.test', firstName: null, lastName: null, description: null, enabled: true }],
      settings: [], resources: [{ id: a, name: 'R', description: null, mimeType: null, content: null }],
      channelGroups: [{ id: a, name: 'G', description: null }], tags: [{ id: a, name: 'T', color: null }],
      channelDependencies: [{ channelId: a, dependsOnChannelId: b }], configMap: [], globalMap: [],
      groupMemberships: [{ channelGroupId: a, channelId: b }], tagAssignments: [{ tagId: a, channelId: b }],
    },
  };
}

describe('a file edited by hand, with its ids in capitals', () => {
  it('imports as the same channels and group', () => {
    expect(channelImportSchema.parse(importFile(caps))).toEqual(channelImportSchema.parse(importFile(same)));
  });

  it('restores as the same backup', () => {
    expect(serverRestoreInputSchema.parse(restoreFile(caps))).toEqual(serverRestoreInputSchema.parse(restoreFile(same)));
  });
});
