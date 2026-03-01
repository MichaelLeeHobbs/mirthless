// ===========================================
// Socket Emission Tests
// ===========================================
// Verifies that deployment and message services emit
// real-time Socket.IO events after successful operations.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from 'stderr-lib';

// ----- Mock Socket -----

const mockEmitToAll = vi.fn();
const mockEmitToRoom = vi.fn();

vi.mock('../../lib/socket.js', () => ({
  emitToAll: (...args: unknown[]) => mockEmitToAll(...args),
  emitToRoom: (...args: unknown[]) => mockEmitToRoom(...args),
}));

// ----- Mock Engine (for DeploymentService) -----

const mockRuntime = {
  getState: vi.fn().mockReturnValue('STOPPED'),
  start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
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

// ----- Mock Channel Service -----

const mockChannelService = {
  getById: vi.fn(),
};

vi.mock('../channel.service.js', () => ({
  ChannelService: mockChannelService,
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// ----- Mock DB (for MessageService) -----

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

// Must import after mocks
const { DeploymentService } = await import('../deployment.service.js');
const { MessageService } = await import('../message.service.js');

// ----- Fixtures -----

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
};

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

// ----- Setup -----

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
});

// ----- Tests -----

describe('Socket emission on deployment state changes', () => {
  it('emits channel:state with STOPPED after deploy', async () => {
    mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

    const result = await DeploymentService.deploy(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToAll).toHaveBeenCalledWith('channel:state', {
      channelId: CHANNEL_ID,
      state: 'STOPPED',
    });
  });

  it('emits channel:state with STARTED after start', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });
    mockRuntime.getState.mockReturnValue('STARTED');

    const result = await DeploymentService.start(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToAll).toHaveBeenCalledWith('channel:state', {
      channelId: CHANNEL_ID,
      state: 'STARTED',
    });
  });

  it('emits channel:state with STOPPED after stop', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });
    mockRuntime.getState.mockReturnValue('STOPPED');

    const result = await DeploymentService.stop(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToAll).toHaveBeenCalledWith('channel:state', {
      channelId: CHANNEL_ID,
      state: 'STOPPED',
    });
  });

  it('emits channel:state with UNDEPLOYED after undeploy', async () => {
    deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

    const result = await DeploymentService.undeploy(CHANNEL_ID);

    expect(result.ok).toBe(true);
    expect(mockEmitToAll).toHaveBeenCalledWith('channel:state', {
      channelId: CHANNEL_ID,
      state: 'UNDEPLOYED',
    });
  });

  it('does not emit when operation fails', async () => {
    // Channel not deployed -> start fails
    const result = await DeploymentService.start(CHANNEL_ID);

    expect(result.ok).toBe(false);
    expect(mockEmitToAll).not.toHaveBeenCalled();
  });
});

describe('Socket emission on message operations', () => {
  it('emits stats:update to dashboard room after incrementStats', async () => {
    const result = await MessageService.incrementStats(
      CHANNEL_ID, 0, SERVER_ID, 'received',
    );

    expect(result.ok).toBe(true);
    expect(mockEmitToRoom).toHaveBeenCalledWith('dashboard', 'stats:update', {
      channelId: CHANNEL_ID,
      metaDataId: 0,
      serverId: SERVER_ID,
      field: 'received',
    });
  });

  it('emits message:new to channel room after createConnectorMessage', async () => {
    const result = await MessageService.createConnectorMessage(
      CHANNEL_ID, MESSAGE_ID, 0, 'Source', 'RECEIVED',
    );

    expect(result.ok).toBe(true);
    expect(mockEmitToRoom).toHaveBeenCalledWith(
      `channel:${CHANNEL_ID}`,
      'message:new',
      { channelId: CHANNEL_ID, messageId: MESSAGE_ID, metaDataId: 0 },
    );
  });

  it('does not throw when socket is not initialized', async () => {
    // emitToRoom and emitToAll are mocked — they won't throw by default.
    // This confirms the service completes successfully even when emission is a no-op.
    mockEmitToRoom.mockImplementation(() => { /* no-op, simulating null IO */ });

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
    // The emission was called but the result is still ok (void)
    expect(mockEmitToRoom).toHaveBeenCalledOnce();
  });
});
