// ===========================================
// Deployment Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from 'stderr-lib';

// ----- Mock Engine -----

const mockRuntime = {
  getState: vi.fn().mockReturnValue('STOPPED'),
  start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  undeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
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

// Must import after mocks
const { DeploymentService } = await import('../deployment.service.js');

// ----- Fixtures -----

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

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
  mockRuntime.undeploy.mockResolvedValue({ ok: true, value: undefined, error: null });
});

// ----- Tests -----

describe('DeploymentService', () => {
  describe('deploy', () => {
    it('deploys a channel and returns STOPPED state', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelId).toBe(CHANNEL_ID);
      expect(result.value.state).toBe('STOPPED');
      expect(mockEngine.deploy).toHaveBeenCalledWith(CHANNEL_DETAIL);
    });

    it('returns NOT_FOUND for non-existent channel', async () => {
      mockChannelService.getById.mockResolvedValue({
        ok: false, value: null, error: { code: 'NOT_FOUND', message: 'Not found' },
      });

      const result = await DeploymentService.deploy('00000000-0000-0000-0000-000000000099');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns CONFLICT if channel already deployed', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });

    it('returns INVALID_INPUT when source connector properties are invalid', async () => {
      const badChannel = {
        ...CHANNEL_DETAIL,
        sourceConnectorType: 'TCP_MLLP',
        sourceConnectorProperties: {},  // missing required port
      };
      mockChannelService.getById.mockResolvedValue(ok(badChannel));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
      expect(result.error.message).toContain('source');
      expect(result.error.message).toContain('TCP_MLLP');
      expect(mockEngine.deploy).not.toHaveBeenCalled();
    });

    it('returns INVALID_INPUT when destination connector properties are invalid', async () => {
      const badChannel = {
        ...CHANNEL_DETAIL,
        destinations: [{
          id: 'dest-1', metaDataId: 1, name: 'Dest 1', enabled: true,
          connectorType: 'SMTP', properties: { host: 'smtp.test.com', port: 587 },  // missing 'to'
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000,
          rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
        }],
      };
      mockChannelService.getById.mockResolvedValue(ok(badChannel));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
      expect(result.error.message).toContain('destination');
      expect(result.error.message).toContain('SMTP');
      expect(mockEngine.deploy).not.toHaveBeenCalled();
    });

    it('deploys successfully with valid destination properties', async () => {
      const goodChannel = {
        ...CHANNEL_DETAIL,
        destinations: [{
          id: 'dest-1', metaDataId: 1, name: 'Dest 1', enabled: true,
          connectorType: 'HTTP', properties: { url: 'http://example.com/api' },
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000,
          rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
        }],
      };
      mockChannelService.getById.mockResolvedValue(ok(goodChannel));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).toHaveBeenCalledOnce();
    });
  });

  describe('start', () => {
    it('starts deployed channel and returns STARTED state', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });
      mockRuntime.getState.mockReturnValue('STARTED');

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('STARTED');
      expect(mockRuntime.start).toHaveBeenCalledOnce();
    });

    it('returns NOT_FOUND if channel not deployed', async () => {
      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('stop', () => {
    it('stops running channel', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });
      mockRuntime.getState.mockReturnValue('STOPPED');

      const result = await DeploymentService.stop(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('STOPPED');
    });
  });

  describe('undeploy', () => {
    it('undeploys stopped channel', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('UNDEPLOYED');
    });

    it('returns NOT_FOUND if not deployed', async () => {
      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns CONFLICT if channel is still running', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('getStatus', () => {
    it('returns current state of deployed channel', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });

      const result = await DeploymentService.getStatus(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelId).toBe(CHANNEL_ID);
      expect(result.value.state).toBe('STARTED');
    });

    it('returns NOT_FOUND if not deployed', async () => {
      const result = await DeploymentService.getStatus(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  describe('getAllStatuses', () => {
    it('returns status of all deployed channels', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [] });

      const result = await DeploymentService.getAllStatuses();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.channelId).toBe(CHANNEL_ID);
    });

    it('returns empty array when no channels deployed', async () => {
      const result = await DeploymentService.getAllStatuses();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('sendMessage', () => {
    const mockProcessMessage = vi.fn();

    it('sends message to STARTED channel and returns messageId', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      mockProcessMessage.mockResolvedValue({ ok: true, value: { messageId: 42 }, error: null });
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [],
        processMessage: mockProcessMessage,
      });

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'MSH|^~\\&|...');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.messageId).toBe(42);
      expect(mockProcessMessage).toHaveBeenCalledWith('MSH|^~\\&|...');
    });

    it('returns NOT_FOUND when channel is not deployed', async () => {
      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'test');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns CONFLICT when channel is STOPPED', async () => {
      mockRuntime.getState.mockReturnValue('STOPPED');
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [],
        processMessage: mockProcessMessage,
      });

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'test');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
      expect(result.error.message).toContain('STOPPED');
    });

    it('returns CONFLICT when channel is PAUSED', async () => {
      mockRuntime.getState.mockReturnValue('PAUSED');
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [],
        processMessage: mockProcessMessage,
      });

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'test');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
      expect(result.error.message).toContain('PAUSED');
    });

    it('returns CONFLICT when processMessage fails', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      mockProcessMessage.mockResolvedValue({ ok: false, value: null, error: new Error('Processing failed') });
      deployedChannels.set(CHANNEL_ID, {
        channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [],
        processMessage: mockProcessMessage,
      });

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'bad message');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
      expect(result.error.message).toContain('Processing failed');
    });
  });
});
