import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from 'stderr-lib';
import { SOCKET_EVENT } from '@galvanigraph/core-models';
import { bundleOf } from '../../../test/deployment-bundle.js';

const mockEmitToChannel = vi.fn();
const mockEmitToRoom = vi.fn();
const mockEmitToRoomCoalesced = vi.fn();

vi.mock('../../lib/socket.js', () => ({
  emitToChannelAudience: (...args: unknown[]) => mockEmitToChannel(...args),
  emitToRoom: (...args: unknown[]) => mockEmitToRoom(...args),
  emitToRoomCoalesced: (...args: unknown[]) => mockEmitToRoomCoalesced(...args),
}));

const mockRuntime = {
  getState: vi.fn().mockReturnValue('STOPPED'),
  start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  runSignal: new AbortController().signal,
};

const deployedChannels = new Map<string, unknown>();

const mockEngine = {
  deploy: vi.fn().mockResolvedValue(undefined),
  undeploy: vi.fn().mockImplementation(async (id: string) => {
    deployedChannels.delete(id);
  }),
  getRuntime: vi.fn().mockImplementation((id: string) => deployedChannels.get(id)),
  getAll: vi.fn().mockReturnValue(deployedChannels),
  dispose: vi.fn(),
};

vi.mock('../../engine.js', () => ({
  getEngine: () => mockEngine,
}));

vi.mock('../channel.service.js', () => ({
  ChannelService: {},
}));

vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { list: vi.fn().mockResolvedValue({ ok: true, value: [], error: null }) },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// ----- Mock Deployment Records (deploy reads the saved bundle and records it) -----

const mockRecords = {
  loadSaved: vi.fn(),
  record: vi.fn(),
  markUndeployed: vi.fn(),
};

vi.mock('../deployment-record.service.js', () => ({
  DeploymentRecordService: mockRecords,
}));

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockExecute = vi.fn().mockResolvedValue([]);

const mockDb = {
  insert: mockInsert,
  execute: mockExecute,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, type: 'sql' }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

const { DeploymentService } = await import('../deployment.service.js');
const { MessageService } = await import('../message.service.js');

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const SERVER_ID = 'server-01';
const MESSAGE_ID = 42;

const CHANNEL_DETAIL = {
  id: CHANNEL_ID,
  name: 'Test Channel',
  enabled: true,
  sourceConnectorType: 'TCP_MLLP',
  sourceConnectorProperties: { port: 6661 },
  inboundDataType: 'HL7V2',
  destinations: [],
  scripts: [],
  filters: [],
  transformers: [],
};

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  deployedChannels.clear();
  mockRuntime.getState.mockReturnValue('STOPPED');
  mockRuntime.start.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.stop.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.halt.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.pause.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.resume.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockInsertValues.mockResolvedValue(undefined);
  mockExecute.mockResolvedValue([]);
  mockRecords.record.mockResolvedValue(ok(undefined));
  mockRecords.markUndeployed.mockResolvedValue(ok(undefined));
});

describe('Socket emission on deployment state changes', () => {
  it('emits channel:state with STOPPED after deploy', async () => {
    mockRecords.loadSaved.mockResolvedValue(ok(bundleOf(CHANNEL_DETAIL as never)));

    const result = await DeploymentService.deploy(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToChannel).toHaveBeenCalledWith(CHANNEL_ID, SOCKET_EVENT.CHANNEL_STATE, {
      channelId: CHANNEL_ID,
      state: 'STOPPED',
    });
  });

  it('emits channel:state with STARTED after start', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
    mockRuntime.getState.mockReturnValue('STARTED');

    const result = await DeploymentService.start(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToChannel).toHaveBeenCalledWith(CHANNEL_ID, SOCKET_EVENT.CHANNEL_STATE, {
      channelId: CHANNEL_ID,
      state: 'STARTED',
    });
  });

  it('emits channel:state with STOPPED after stop', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
    mockRuntime.getState.mockReturnValue('STOPPED');

    const result = await DeploymentService.stop(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToChannel).toHaveBeenCalledWith(CHANNEL_ID, SOCKET_EVENT.CHANNEL_STATE, {
      channelId: CHANNEL_ID,
      state: 'STOPPED',
    });
  });

  it('emits channel:state with UNDEPLOYED after undeploy', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

    const result = await DeploymentService.undeploy(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToChannel).toHaveBeenCalledWith(CHANNEL_ID, SOCKET_EVENT.CHANNEL_STATE, {
      channelId: CHANNEL_ID,
      state: 'UNDEPLOYED',
    });
  });

  it('does not emit when operation fails', async () => {
    const result = await DeploymentService.start(CHANNEL_ID);

    expect(result.ok).toBe(false);
    expect(mockEmitToChannel).not.toHaveBeenCalled();
  });
});

describe('Socket emission on message operations', () => {
  // The per-message events are coalesced per room (#231, D-306), so their
  // payload carries only what stays true for a whole window of events.
  it('emits a coalesced stats:update to dashboard room after incrementStats', async () => {
    const result = await MessageService.incrementStats(
      CHANNEL_ID, 0, SERVER_ID, 'received',
    );

    expect(result.ok).toBe(true);
    expect(mockEmitToRoomCoalesced).toHaveBeenCalledWith('dashboard', SOCKET_EVENT.STATS_UPDATE, {});
    expect(mockEmitToRoom).not.toHaveBeenCalled();
  });

  it('emits a coalesced message:new to channel room after createConnectorMessage', async () => {
    const result = await MessageService.createConnectorMessage(
      CHANNEL_ID, MESSAGE_ID, 0, 'Source', 'RECEIVED',
    );

    expect(result.ok).toBe(true);
    expect(mockEmitToRoomCoalesced).toHaveBeenCalledWith(
      `channel:${CHANNEL_ID}`,
      SOCKET_EVENT.MESSAGE_NEW,
      { channelId: CHANNEL_ID },
    );
    expect(mockEmitToRoom).not.toHaveBeenCalled();
  });

  it('does not throw when socket is not initialized', async () => {
    mockEmitToRoomCoalesced.mockImplementation(() => {});

    const result = await MessageService.incrementStats(
      CHANNEL_ID, 0, SERVER_ID, 'sent',
    );

    expect(result.ok).toBe(true);
  });

  it('emission does not block the service operation return value', async () => {
    const result = await MessageService.createConnectorMessage(
      CHANNEL_ID, MESSAGE_ID, 1, 'Dest 1', 'RECEIVED',
    );

    expect(result.ok).toBe(true);
    expect(mockEmitToRoomCoalesced).toHaveBeenCalledOnce();
  });
});
