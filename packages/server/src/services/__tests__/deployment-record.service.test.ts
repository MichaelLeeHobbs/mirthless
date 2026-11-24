// ===========================================
// Deployment Record Service: reading a stored deployment back (#225)
// ===========================================
// A record this version cannot read is refused, never filled in. The database
// is the boundary mocked here; writing and the transactions are covered
// against Postgres by test/integration/restart-deploys-recorded.itest.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: unknown[] = [];
const mockWhere = vi.fn(async () => rows);
vi.mock('../../lib/db.js', () => ({
  db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));

const { DeploymentRecordService, DEPLOYMENT_FORMAT } = await import('../deployment-record.service.js');
const { bundleOf, deployedTemplate } = await import('../../../test/deployment-bundle.js');

const ID = '00000000-0000-4000-8000-000000000001';

/** A channel with every ChannelDetail field, as JSON stores it (times as text). */
const STORED_CHANNEL = {
  id: ID, name: 'ADT in', description: '', enabled: true, revision: 4,
  inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', sourceConnectorType: 'TCP_MLLP',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
  responseMode: 'AUTO_AFTER_DESTINATIONS', responseConnectorName: null, initialState: 'STARTED',
  messageStorageMode: 'DEVELOPMENT', encryptData: false, removeContentOnCompletion: false,
  removeAttachmentsOnCompletion: false, pruningEnabled: false, pruningMaxAgeDays: null,
  pruningArchiveEnabled: false, scriptTimeoutSeconds: 30, sourceConnectorProperties: { port: 6661 },
  scripts: [], destinations: [], metadataColumns: [], tags: [], filters: [], transformers: [],
};

function row(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const bundle = bundleOf(STORED_CHANNEL as never, { templates: [deployedTemplate({ code: 'function f() {}' })] });
  return {
    channelId: ID, channelRevision: 4, format: DEPLOYMENT_FORMAT, channel: STORED_CHANNEL,
    codeTemplates: bundle.templates, globalScripts: bundle.globalScripts,
    deployedBy: null, deployedAt: new Date(), undeployedAt: null, heldReason: null, ...fields,
  };
}

async function readOne(): Promise<unknown> {
  const result = await DeploymentRecordService.listRecorded([ID]);
  if (!result.ok) throw result.error;
  return result.value.get(ID);
}

beforeEach(() => {
  rows = [];
  mockWhere.mockClear();
});

describe('DeploymentRecordService.listRecorded', () => {
  it('reads a record back as the bundle that was deployed, with its times as Dates', async () => {
    rows = [row()];

    const recorded = await readOne() as { kind: string; bundle: { channel: { createdAt: Date; revision: number }; templates: unknown[] } };

    expect(recorded.kind).toBe('deployed');
    expect(recorded.bundle.channel.createdAt).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(recorded.bundle.channel.revision).toBe(4);
    expect(recorded.bundle.templates).toHaveLength(1);
  });

  it('reports an undeployed channel without reading its bundle', async () => {
    rows = [row({ undeployedAt: new Date(), format: 999 })];

    expect(await readOne()).toEqual({ kind: 'undeployed' });
  });

  it('reports a channel the script watchdog holds without reading its bundle', async () => {
    rows = [row({ heldReason: 'A script was stuck.', format: 999 })];

    expect(await readOne()).toEqual({ kind: 'held', reason: 'A script was stuck.' });
  });

  it('reports a held channel someone undeployed as undeployed', async () => {
    rows = [row({ heldReason: 'A script was stuck.', undeployedAt: new Date() })];

    expect(await readOne()).toEqual({ kind: 'undeployed' });
  });

  it('refuses a record in a format this version does not know', async () => {
    rows = [row({ format: 999 })];

    expect(await readOne()).toEqual({ kind: 'unreadable', reason: 'its deployment record is in format 999, which this version does not read' });
  });

  it('refuses a record missing a channel field rather than deploying it undefined', async () => {
    const { scriptTimeoutSeconds: _dropped, ...older } = STORED_CHANNEL;
    rows = [row({ channel: older })];

    expect(await readOne()).toEqual({ kind: 'unreadable', reason: 'its deployment record is missing channel.scriptTimeoutSeconds' });
  });

  it('refuses a record whose code templates are not a list', async () => {
    rows = [row({ codeTemplates: {} })];

    expect(await readOne()).toEqual({ kind: 'unreadable', reason: 'its deployment record is missing codeTemplates' });
  });

  it('leaves out a channel with no record, and asks nothing for no channels', async () => {
    const none = await DeploymentRecordService.listRecorded([]);

    expect(none.ok && none.value.size).toBe(0);
    expect(mockWhere).not.toHaveBeenCalled();
    expect(await readOne()).toBeUndefined();
  });
});
