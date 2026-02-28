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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('start', () => {
    it('starts deployed channel and returns STARTED state', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });
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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });
      mockRuntime.getState.mockReturnValue('STOPPED');

      const result = await DeploymentService.stop(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('STOPPED');
    });
  });

  describe('undeploy', () => {
    it('undeploys stopped channel', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('getStatus', () => {
    it('returns current state of deployed channel', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime });

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
});
