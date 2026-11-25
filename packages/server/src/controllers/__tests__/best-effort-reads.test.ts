// D-312: these reads are recorded in the background and always sent.
// recordReadBestEffort has its own tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const recordReadBestEffort = vi.fn();
// A person's counted read is best effort (a key's is covered by audited-read.test.ts).
const recordCountedRead = vi.fn((req: unknown, _res: unknown, read: unknown) => { recordReadBestEffort(req, read); return Promise.resolve(true); });
vi.mock('../../lib/audited-read.js', () => ({ recordReadBestEffort, recordReadOrRefuse: vi.fn(), recordCountedRead }));
vi.mock('../../lib/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const ok = <T>(value: T): { ok: true; value: T; error: null } => ({ ok: true, value, error: null });
const configMap = { list: vi.fn(), getByKey: vi.fn() };
const globalMap = { list: vi.fn(), getByKey: vi.fn() };
const collections = { listRecords: vi.fn() };
const channels = { getById: vi.fn() };
const events = { list: vi.fn() };
const logs = { query: vi.fn(() => ({ entries: [], total: 0 })) };
vi.mock('../../services/config-map.service.js', () => ({ ConfigMapService: configMap }));
vi.mock('../../services/global-map.service.js', () => ({ GlobalMapService: globalMap }));
vi.mock('../../services/collection.service.js', () => ({ CollectionService: collections }));
vi.mock('../../services/channel.service.js', () => ({ ChannelService: channels }));
vi.mock('../../services/event.service.js', () => ({ EventService: events }));
vi.mock('../../services/log-stream.service.js', () => ({ LogStreamService: logs }));

const { ConfigMapController } = await import('../config-map.controller.js');
const { GlobalMapController } = await import('../global-map.controller.js');
const { CollectionController } = await import('../collection.controller.js');
const { ChannelController } = await import('../channel.controller.js');
const { EventController } = await import('../event.controller.js');
const { LogController } = await import('../log.controller.js');
const { standingFor } = await import('../../../test/standing.js');

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}
const req = (parts: Record<string, unknown> = {}): Request => ({ params: {}, query: {}, user: { id: 'u1', permissions: [] }, ...parts }) as unknown as Request;
const recorded = (): Record<string, unknown> => recordReadBestEffort.mock.calls[0]?.[1] as Record<string, unknown>;

beforeEach(() => { vi.clearAllMocks(); });

describe('best-effort reads', () => {
  it('records a configuration map list and still sends it', async () => {
    configMap.list.mockResolvedValue(ok([{ category: 'db', name: 'url', value: 'x' }]));
    const res = makeRes();
    await ConfigMapController.list(req(), res);
    expect(recorded()).toMatchObject({ action: 'CONFIG_MAP_READ', attributes: { category: null, entries: 1 }, dedupe: { ids: ['db/url'] } });
    expect(res.json).toHaveBeenCalledOnce();
  });

  it('records a configuration map entry read', async () => {
    configMap.getByKey.mockResolvedValue(ok({ category: 'db', name: 'url', value: 'x' }));
    await ConfigMapController.getByKey(req({ params: { category: 'db', name: 'url' } }), makeRes());
    expect(recorded()).toMatchObject({ action: 'CONFIG_MAP_READ', attributes: { category: 'db', name: 'url' } });
  });

  it('records global map reads, list and entry', async () => {
    globalMap.list.mockResolvedValue(ok([{ key: 'k1', value: 'v' }]));
    globalMap.getByKey.mockResolvedValue(ok({ key: 'k1', value: 'v' }));
    await GlobalMapController.list(req(), makeRes());
    await GlobalMapController.getByKey(req({ params: { key: 'k1' } }), makeRes());
    expect(recordReadBestEffort.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual(['GLOBAL_MAP_READ', 'GLOBAL_MAP_READ']);
  });

  it('records a page of collection records with the record ids', async () => {
    collections.listRecords.mockResolvedValue(ok({ items: [{ id: 'r1' }, { id: 'r2' }], total: 2 }));
    await CollectionController.listRecords(req({ params: { id: 'k1' }, query: { limit: 25 } }), makeRes());
    expect(recorded()).toMatchObject({ action: 'COLLECTION_RECORDS_READ', attributes: { collectionId: 'k1', total: 2 }, dedupe: { ids: ['r1', 'r2'] }, rows: 2 });
  });

  it('records a server log read with its query', () => {
    LogController.getEntries(req({ query: { search: 'Smith' } }), makeRes());
    expect(recorded()).toMatchObject({ action: 'SERVER_LOG_READ', attributes: { query: { search: 'Smith' } } });
  });

  it('records a channel read only when its secrets are unmasked', async () => {
    channels.getById.mockResolvedValue(ok({ id: 'c1', sourceConnectorProperties: {} }));
    await ChannelController.getById(req({ params: { id: 'c1' } }), makeRes());
    expect(recordReadBestEffort).not.toHaveBeenCalled();

    await ChannelController.getById(req({ params: { id: 'c1' }, principal: { userId: 'u1', grants: standingFor({ id: 'u1', role: 'developer' }).grants } }), makeRes());
    expect(recorded()).toMatchObject({ action: 'CHANNEL_SECRETS_READ', channelId: 'c1' });
  });

  it('records an Events page search with its total', async () => {
    events.list.mockResolvedValue(ok({ data: [{ id: 7 }], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }));
    await EventController.list(req({ query: { page: 1, pageSize: 25 } }), makeRes());
    expect(recorded()).toMatchObject({ action: 'EVENTS_SEARCHED', attributes: { total: 1 }, dedupe: { ids: [7] } });
  });

  it('records nothing for a read that fails', async () => {
    configMap.list.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });
    await ConfigMapController.list(req(), makeRes());
    expect(recordReadBestEffort).not.toHaveBeenCalled();
  });
});
