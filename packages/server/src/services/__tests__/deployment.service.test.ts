import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from 'stderr-lib';
import { ServiceError } from '../../lib/service-error.js';

const mockRuntime = {
  getState: vi.fn().mockReturnValue('STOPPED'),
  start: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  stop: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  halt: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  pause: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  resume: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  undeploy: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
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
  checkScripts: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../../engine.js', () => ({
  getEngine: () => mockEngine,
}));

const mockChannelService = {
  getById: vi.fn(),
  listLiveForDeploy: vi.fn(),
};

const mockListAllDependencies = vi.fn();
vi.mock('../channel-dependency.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../channel-dependency.service.js')>();
  return { ...actual, ChannelDependencyService: { listAll: mockListAllDependencies } };
});

vi.mock('../channel.service.js', () => ({
  ChannelService: mockChannelService,
}));

const mockReferences = vi.fn().mockResolvedValue({ ok: true, value: new Map(), error: null });
vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { references: mockReferences },
}));

const mockEmitEvent = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: mockEmitEvent,
}));

// ----- Mock Deployment Records -----
// A deploy reads the saved channel (through ChannelService.getById, mocked
// above) as a bundle, records it, and the startup redeploy reads the records.

const okVoid = { ok: true, value: undefined, error: null };
const mockRecords = {
  loadSaved: vi.fn(),
  record: vi.fn(),
  markUndeployed: vi.fn(),
  listRecorded: vi.fn(),
  listPendingAdoptions: vi.fn(),
  dropAdoptions: vi.fn(),
  adoptSaved: vi.fn(),
};
vi.mock('../deployment-record.service.js', () => ({ DeploymentRecordService: mockRecords }));

// Must import after mocks
const { DeploymentService } = await import('../deployment.service.js');
const { bundleOf } = await import('../../../test/deployment-bundle.js');
type Bundle = ReturnType<typeof bundleOf>;
type Detail = Parameters<typeof bundleOf>[0];

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
  filters: [],
  transformers: [],
};

function withTypeScriptStep(script: string): typeof CHANNEL_DETAIL {
  return {
    ...CHANNEL_DETAIL,
    transformers: [{
      id: 't1', connectorId: null, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
      inboundProperties: {}, outboundProperties: {}, inboundTemplate: null, outboundTemplate: null,
      steps: [{
        id: 's1', sequenceNumber: 0, enabled: true, name: 'Normalize MRN', type: 'JAVASCRIPT', script,
        language: 'TYPESCRIPT', sourceField: null, targetField: null, defaultValue: null, mapping: null,
      }],
    }],
  } as unknown as typeof CHANNEL_DETAIL;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

/** The bundle a deploy of `channel` hands the engine. */
function bundle(channel: object): Bundle {
  return bundleOf(channel as unknown as Detail);
}

/** A registered runtime for CHANNEL_ID, as the engine keeps one after deploy. */
function register(id = CHANNEL_ID): void {
  deployedChannels.set(id, { channelId: id, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  deployedChannels.clear();
  mockRecords.loadSaved.mockImplementation(async (id: string) => {
    const saved = await mockChannelService.getById(id) as Result<object>;
    return saved.ok ? ok(bundle(saved.value)) : saved;
  });
  mockRecords.record.mockResolvedValue(okVoid);
  mockRecords.markUndeployed.mockResolvedValue(okVoid);
  mockRecords.listRecorded.mockResolvedValue(ok(new Map()));
  mockRecords.listPendingAdoptions.mockResolvedValue(ok(new Set()));
  mockRecords.dropAdoptions.mockResolvedValue(okVoid);
  mockEngine.deploy.mockResolvedValue(undefined);
  mockRuntime.getState.mockReturnValue('STOPPED');
  mockRuntime.start.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.stop.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.halt.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.pause.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.resume.mockResolvedValue({ ok: true, value: undefined, error: null });
  mockRuntime.undeploy.mockResolvedValue({ ok: true, value: undefined, error: null });
});

describe('DeploymentService', () => {
  describe('deploy', () => {
    it('deploys a channel and returns STOPPED state', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelId).toBe(CHANNEL_ID);
      expect(result.value.state).toBe('STOPPED');
      expect(mockEngine.deploy).toHaveBeenCalledWith(bundle(CHANNEL_DETAIL));
    });

    it('records what it deployed, with who deployed it, so a restart runs that', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

      const result = await DeploymentService.deploy(CHANNEL_ID, { userId: 'user-1', ipAddress: null });

      expect(result.ok).toBe(true);
      expect(mockRecords.record).toHaveBeenCalledWith(bundle(CHANNEL_DETAIL), 'user-1');
      expect(mockRecords.record.mock.invocationCallOrder[0]!).toBeGreaterThan(mockEngine.deploy.mock.invocationCallOrder[0]!);
    });

    it('records the channel before configuration map references are resolved', async () => {
      mockReferences.mockResolvedValueOnce(ok(new Map([['SECRET_HOST', '10.0.0.9']])));
      const channel = { ...CHANNEL_DETAIL, sourceConnectorProperties: { port: 6661, host: '${SECRET_HOST}' } };
      mockChannelService.getById.mockResolvedValue(ok(channel));

      await DeploymentService.deploy(CHANNEL_ID);

      const recorded = mockRecords.record.mock.calls[0]?.[0] as Bundle;
      expect(recorded.channel.sourceConnectorProperties).toEqual({ port: 6661, host: '${SECRET_HOST}' });
    });

    it('undeploys and fails when the deployment cannot be recorded', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockEngine.deploy.mockImplementationOnce(async () => { register(); });
      mockRecords.record.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INTERNAL');
      expect(result.error.message).toContain('a restart would not run it');
      expect(mockEngine.undeploy).toHaveBeenCalledWith(CHANNEL_ID);
      expect(deployedChannels.has(CHANNEL_ID)).toBe(false);
    });

    it('says the channel is still deployed when neither the record nor the undo can be written', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockEngine.deploy.mockImplementationOnce(async () => { register(); });
      mockRecords.record.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });
      mockEngine.undeploy.mockRejectedValueOnce(new Error('global map flush failed'));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('it is deployed and stopped');
      expect(mockEmitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'CHANNEL_DEPLOYED' }));
    });

    it('lets an undeploy started during a deploy wait until the deploy is recorded', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      let finishDeploy: (() => void) | undefined;
      mockEngine.deploy.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishDeploy = (): void => { register(); resolve(); };
      }));

      const deploying = DeploymentService.deploy(CHANNEL_ID);
      const undeploying = DeploymentService.undeploy(CHANNEL_ID);
      await vi.waitFor(() => { expect(finishDeploy).toBeDefined(); });
      expect(mockRecords.markUndeployed).not.toHaveBeenCalled();
      finishDeploy?.();

      expect((await deploying).ok).toBe(true);
      expect((await undeploying).ok).toBe(true);
      expect(mockRecords.record.mock.invocationCallOrder[0]!).toBeLessThan(mockRecords.markUndeployed.mock.invocationCallOrder[0]!);
    });

    it('refuses a disabled channel', async () => {
      mockChannelService.getById.mockResolvedValue(ok({ ...CHANNEL_DETAIL, enabled: false }));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(result.error).toHaveProperty('code', 'CONFLICT');
      expect(mockEngine.deploy).not.toHaveBeenCalled();
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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

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

    it('names the destination (and its metaDataId) whose properties are invalid', async () => {
      const dest = {
        id: 'dest-x', enabled: true, properties: {}, queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000,
        rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
      };
      const badChannel = {
        ...CHANNEL_DETAIL,
        destinations: [
          { ...dest, id: 'dest-1', metaDataId: 1, name: 'To LIS', connectorType: 'TCP_MLLP', properties: { host: 'lis', port: 6661 } },
          { ...dest, id: 'dest-2', metaDataId: 2, name: 'To Archive', connectorType: 'FILE' },
        ],
      };
      mockChannelService.getById.mockResolvedValue(ok(badChannel));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Destination "To Archive" (metaDataId 2)');
      expect(result.error.message).toContain('directory');
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

    it('resolves configuration map references in connector settings before validating them', async () => {
      mockReferences.mockResolvedValueOnce(ok(new Map([['SENDER_HOST', '10.0.0.5'], ['site.SENDER_PORT', '6661']])));
      mockChannelService.getById.mockResolvedValue(ok({
        ...CHANNEL_DETAIL,
        destinations: [{
          id: 'dest-1', metaDataId: 1, name: 'Sender', enabled: true,
          connectorType: 'TCP_MLLP', properties: { host: '${SENDER_HOST}', port: '${site.SENDER_PORT}', template: '${oru}' },
          queueMode: 'NEVER', retryCount: 0, retryIntervalMs: 10000,
          rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
        }],
      }));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      const deployed = mockEngine.deploy.mock.calls[0]?.[0] as Bundle;
      expect(deployed.channel.destinations[0]?.properties).toEqual({ host: '10.0.0.5', port: '6661', template: '${oru}' });
    });

    it('fails the deploy when the configuration map cannot be loaded', async () => {
      mockReferences.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(mockEngine.deploy).not.toHaveBeenCalled();
    });
  });

  describe('deploy with a channel set to start on deploy', () => {
    const AUTO_START = { ...CHANNEL_DETAIL, initialState: 'STARTED' };
    const registerOnDeploy = (): void => {
      mockEngine.deploy.mockImplementationOnce(async () => {
        deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      });
    };

    it('starts the channel', async () => {
      mockChannelService.getById.mockResolvedValue(ok(AUTO_START));
      registerOnDeploy();
      mockRuntime.start.mockImplementation(async () => {
        mockRuntime.getState.mockReturnValue('STARTED');
        return { ok: true, value: undefined, error: null };
      });

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok && result.value.state).toBe('STARTED');
    });

    it('fails, saying why, when the channel cannot start, and leaves it deployed and stopped', async () => {
      mockChannelService.getById.mockResolvedValue(ok(AUTO_START));
      registerOnDeploy();
      mockRuntime.start.mockResolvedValue({ ok: false, value: null, error: new Error('Source start failed: listen EADDRINUSE :::6661') });

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe(
        'Channel was deployed but is stopped. Cannot start channel: Source start failed: listen EADDRINUSE :::6661',
      );
      expect(deployedChannels.has(CHANNEL_ID)).toBe(true);
    });
  });

  describe('halt', () => {
    const FAILED = { ok: false, value: null, error: new Error('Source halt failed: port still open') };
    const deployed = (): void => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
    };

    it('says what failed when a connector did not halt, and records that the channel stopped (#419)', async () => {
      deployed();
      mockRuntime.getState.mockReturnValueOnce('STARTED').mockReturnValue('STOPPED');
      mockRuntime.halt.mockResolvedValue(FAILED);

      const result = await DeploymentService.halt(CHANNEL_ID);

      expect(result.error).toMatchObject({ code: 'CONFLICT', message: 'The channel is halted, but: Source halt failed: port still open' });
      expect(mockEmitEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        name: 'CHANNEL_STOPPED', level: 'ERROR', outcome: 'FAILURE', channelId: CHANNEL_ID,
        attributes: { method: 'halt', error: 'Source halt failed: port still open' },
      }));
    });

    it.each([
      ['it was not running', 'STOPPED', 'STOPPED'],
      ['it is still running', 'STARTED', 'STARTED'],
    ])('records nothing when the channel was not halted because %s', async (_why, before, after) => {
      deployed();
      mockRuntime.getState.mockReturnValueOnce(before).mockReturnValue(after);
      mockRuntime.halt.mockResolvedValue({ ok: false, value: null, error: new Error('no') });

      const result = await DeploymentService.halt(CHANNEL_ID);

      expect(result.error).toMatchObject({ code: 'CONFLICT', message: 'Cannot halt channel: no' });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  describe('redeploy of a running channel', () => {
    it('fails when the channel cannot be started again', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockRuntime.getState.mockReturnValueOnce('STARTED').mockReturnValueOnce('STARTED').mockReturnValue('STOPPED');
      mockEngine.deploy.mockImplementationOnce(async () => {
        deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      });
      mockRuntime.start.mockResolvedValue({ ok: false, value: null, error: new Error('Source start failed: port busy') });

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Channel was redeployed but is stopped. Cannot start channel: Source start failed: port busy');
    });
  });

  describe('start', () => {
    it('starts deployed channel and returns STARTED state', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      mockRuntime.getState.mockReturnValue('STARTED');

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('STARTED');
      expect(mockRuntime.start).toHaveBeenCalledOnce();
    });

    it('releases stale queue claims before the consumers start, and recovers after', async () => {
      const order: string[] = [];
      mockRuntime.start.mockImplementationOnce(async () => { order.push('runtime.start'); return { ok: true, value: undefined, error: null }; });
      const consumer = { start: vi.fn(() => { order.push('consumer.start'); }), stop: vi.fn() };
      const recoverOnce = vi.fn(async () => { order.push('recover'); });
      const resetClaimsOnce = vi.fn(async () => { order.push('reset claims'); });
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [consumer], recoverOnce, resetClaimsOnce });
      mockRuntime.getState.mockReturnValue('STARTED');

      await DeploymentService.start(CHANNEL_ID);

      expect(order).toEqual(['runtime.start', 'reset claims', 'consumer.start', 'recover']);
    });

    it('does not wait for crash recovery, and a recovery failure does not fail the start', async () => {
      let finish: (() => void) | undefined;
      const recoverOnce = vi.fn(() => new Promise<void>((_resolve, reject) => { finish = (): void => { reject(new Error('recovery broke')); }; }));
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce, resetClaimsOnce: async () => {} });
      mockRuntime.getState.mockReturnValue('STARTED');

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(recoverOnce).toHaveBeenCalledOnce();
      finish?.();
      await Promise.resolve();
    });

    it('starts no consumer on a channel that was halted before it had started', async () => {
      const consumer = { start: vi.fn(), stop: vi.fn() };
      const recoverOnce = vi.fn(async () => {});
      mockRuntime.getState.mockReturnValue('STARTED');
      const run = new AbortController();
      // Aborted as a stop or a halt begins, long before the state says so.
      const resetClaimsOnce = async (): Promise<void> => { run.abort(); };
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: { ...mockRuntime, runSignal: run.signal }, queueConsumers: [consumer], recoverOnce, resetClaimsOnce });

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.error?.message).toBe('Cannot start channel: it was stopped before it had started');
      expect(consumer.start).not.toHaveBeenCalled();
      expect(recoverOnce).not.toHaveBeenCalled();
    });

    it('does not run recovery when the runtime fails to start', async () => {
      mockRuntime.start.mockResolvedValueOnce({ ok: false, value: null, error: new Error('port in use') });
      const recoverOnce = vi.fn(async () => {});
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce, resetClaimsOnce: async () => {} });

      const result = await DeploymentService.start(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(recoverOnce).not.toHaveBeenCalled();
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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      mockRuntime.getState.mockReturnValue('STOPPED');

      const result = await DeploymentService.stop(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('STOPPED');
    });
  });

  describe('undeploy', () => {
    it('undeploys stopped channel', async () => {
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state).toBe('UNDEPLOYED');
    });

    it('marks the deployment undeployed before undeploying, so a restart leaves it undeployed', async () => {
      register();

      await DeploymentService.undeploy(CHANNEL_ID);

      expect(mockRecords.markUndeployed).toHaveBeenCalledWith(CHANNEL_ID, true);
      expect(mockRecords.markUndeployed.mock.invocationCallOrder[0]!).toBeLessThan(mockEngine.undeploy.mock.invocationCallOrder[0]!);
    });

    it('undeploys nothing when the mark cannot be recorded', async () => {
      register();
      mockRecords.markUndeployed.mockResolvedValueOnce({ ok: false, value: null, error: new Error('db down') });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('a restart would bring it back');
      expect(mockEngine.undeploy).not.toHaveBeenCalled();
    });

    it('clears the mark when the undeploy itself fails', async () => {
      register();
      mockEngine.undeploy.mockRejectedValueOnce(new Error('undeploy script failed'));

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(mockRecords.markUndeployed).toHaveBeenLastCalledWith(CHANNEL_ID, false);
    });

    it('returns NOT_FOUND if not deployed', async () => {
      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('marks the record of a channel that is not running but would come back at a restart', async () => {
      // A redeploy stopped the old version and the new one failed: nothing runs,
      // and the record still holds the old version.
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([[CHANNEL_ID, { kind: 'deployed', bundle: bundle(CHANNEL_DETAIL) }]])));

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok && result.value.state).toBe('UNDEPLOYED');
      expect(mockRecords.markUndeployed).toHaveBeenCalledWith(CHANNEL_ID, true);
      expect(mockEngine.undeploy).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for a channel already marked undeployed', async () => {
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([[CHANNEL_ID, { kind: 'undeployed' }]])));

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
      expect(mockRecords.markUndeployed).not.toHaveBeenCalled();
    });

    it('returns CONFLICT if channel is still running', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

      const result = await DeploymentService.undeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });
  });

  describe('redeploy', () => {
    it('re-applies config for a stopped deployed channel (undeploy then deploy)', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockRuntime.getState.mockReturnValue('STOPPED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockEngine.undeploy).toHaveBeenCalledWith(CHANNEL_ID);
      expect(mockEngine.deploy).toHaveBeenCalledWith(bundle(CHANNEL_DETAIL));
      expect(mockRuntime.stop).not.toHaveBeenCalled();
    });

    it('reads the saved channel once, so what it checks is what it deploys and records', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      register();

      await DeploymentService.redeploy(CHANNEL_ID);

      expect(mockRecords.loadSaved).toHaveBeenCalledOnce();
      const checked = mockEngine.checkScripts.mock.calls[0]?.[0] as Bundle;
      const deployed = mockEngine.deploy.mock.calls[0]?.[0] as Bundle;
      expect(mockRecords.record.mock.calls[0]?.[0]).toBe(checked);
      // The engine gets the same bundle with configuration map references resolved.
      expect(deployed.templates).toBe(checked.templates);
      expect(deployed.globalScripts).toBe(checked.globalScripts);
      expect(deployed.channel).toEqual(checked.channel);
    });

    it('does not mark the deployment undeployed while replacing it', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      register();

      await DeploymentService.redeploy(CHANNEL_ID);

      expect(mockRecords.markUndeployed).not.toHaveBeenCalled();
    });

    it('refuses a disabled channel before stopping it', async () => {
      mockChannelService.getById.mockResolvedValue(ok({ ...CHANNEL_DETAIL, enabled: false }));
      mockRuntime.getState.mockReturnValue('STARTED');
      register();

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(mockRuntime.stop).not.toHaveBeenCalled();
      expect(deployedChannels.has(CHANNEL_ID)).toBe(true);
    });

    it('leaves a running channel untouched when the saved scripts do not compile', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });
      mockEngine.checkScripts.mockRejectedValueOnce(new Error('Script Test/sourceFilter.ts failed to compile: Unexpected token'));

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('failed to compile');
      expect(mockRuntime.stop).not.toHaveBeenCalled();
      expect(mockEngine.undeploy).not.toHaveBeenCalled();
      expect(mockEngine.deploy).not.toHaveBeenCalled();
      expect(deployedChannels.has(CHANNEL_ID)).toBe(true);
    });

    it('checks the saved scripts before stopping a running channel', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

      await DeploymentService.redeploy(CHANNEL_ID);

      expect(mockEngine.checkScripts).toHaveBeenCalledWith(bundle(CHANNEL_DETAIL));
      expect(mockEngine.checkScripts.mock.invocationCallOrder[0]!).toBeLessThan(mockRuntime.stop.mock.invocationCallOrder[0]!);
    });

    it('deploys directly when the channel is not currently deployed', async () => {
      mockChannelService.getById.mockResolvedValue(ok(CHANNEL_DETAIL));

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockEngine.undeploy).not.toHaveBeenCalled();
      expect(mockEngine.deploy).toHaveBeenCalledWith(bundle(CHANNEL_DETAIL));
    });

    it('leaves a running channel untouched when a saved TypeScript script has type errors', async () => {
      mockChannelService.getById.mockResolvedValue(ok(withTypeScriptStep("const n: number = '1';")));
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

      const result = await DeploymentService.redeploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      expect(mockRuntime.stop).not.toHaveBeenCalled();
      expect(mockEngine.undeploy).not.toHaveBeenCalled();
      expect(deployedChannels.has(CHANNEL_ID)).toBe(true);
    });
  });

  describe('TypeScript type check', () => {
    it('refuses a deploy whose TypeScript step has a type error, naming the step and line', async () => {
      mockChannelService.getById.mockResolvedValue(ok(withTypeScriptStep("const mrn = msg.get('PID.3');\nconst n: number = mrn;")));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
      expect(result.error.message).toContain('"Test Channel" was not deployed: a TypeScript script has type errors.');
      expect(result.error.message).toContain(
        "- Source transformer step \"Normalize MRN\", line 2: Type 'string | undefined' is not assignable to type 'number'.",
      );
      expect(mockEngine.deploy).not.toHaveBeenCalled();
    });

    it('deploys a TypeScript step that type-checks', async () => {
      mockChannelService.getById.mockResolvedValue(ok(withTypeScriptStep("const mrn: string | undefined = msg.get('PID.3');")));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).toHaveBeenCalled();
    });

    it('never type-checks a JavaScript step', async () => {
      const js = withTypeScriptStep("const n = 1; n.nope.deeper();");
      (js as unknown as { transformers: Array<{ steps: Array<{ language: string }> }> }).transformers[0]!.steps[0]!.language = 'JAVASCRIPT';
      mockChannelService.getById.mockResolvedValue(ok(js));

      const result = await DeploymentService.deploy(CHANNEL_ID);

      expect(result.ok).toBe(true);
    });

    it('still deploys at startup, so a channel that was running comes back after a restart', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([{ id: CHANNEL_ID, name: 'Test Channel', enabled: true }]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([
        [CHANNEL_ID, { kind: 'deployed', bundle: bundle(withTypeScriptStep("const n: number = '1';")) }],
      ])));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('returns current state of deployed channel', async () => {
      mockRuntime.getState.mockReturnValue('STARTED');
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

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
      deployedChannels.set(CHANNEL_ID, { channelId: CHANNEL_ID, runtime: mockRuntime, queueConsumers: [], recoverOnce: async () => {}, resetClaimsOnce: async () => {} });

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
    // The guards themselves live in EngineManager.sendMessage and are tested in
    // engine-send-message.test.ts; this service only hands the call through.

    it('returns the engine dispatch outcome for the channel', async () => {
      const outcome = { messageId: 42, status: 'SENT', response: 'ACK' };
      mockEngine.sendMessage.mockResolvedValue(ok(outcome));

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'MSH|^~\\&|...');

      expect(mockEngine.sendMessage).toHaveBeenCalledWith(CHANNEL_ID, 'MSH|^~\\&|...');
      expect(result).toEqual(ok(outcome));
    });

    it.each([
      ['NOT_FOUND', `Channel ${CHANNEL_ID} is not deployed`],
      ['CONFLICT', 'Channel is STOPPED, must be STARTED to receive messages'],
      ['CONFLICT', 'Processing failed'],
    ] as const)('passes the engine %s error "%s" to the caller unchanged', async (code, message) => {
      const error = new ServiceError(code, message);
      mockEngine.sendMessage.mockResolvedValue({ ok: false, value: null, error });

      const result = await DeploymentService.sendMessage(CHANNEL_ID, 'test');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', code);
      expect(result.error.message).toBe(message);
    });
  });

  describe('autoDeployChannels', () => {
    const summary = (id: string, enabled = true): { id: string; name: string; enabled: boolean } =>
      ({ id, name: `ch-${id}`, enabled });


    function deployedOrder(): string[] {
      return mockEngine.deploy.mock.calls.map((c) => (c[0] as Bundle).channel.id);
    }

    /** Every listed channel has a recorded deployment of CHANNEL_DETAIL under its own id. */
    beforeEach(() => {
      mockRecords.listRecorded.mockImplementation(async (ids: readonly string[]) => ok(new Map(
        ids.map((id) => [id, { kind: 'deployed', bundle: bundle({ ...CHANNEL_DETAIL, id }) }]),
      )));
    });

    it('deploys the recorded deployment and never reads the saved configuration', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      const recorded = bundle({ ...CHANNEL_DETAIL, id: 'a', revision: 3 });
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([['a', { kind: 'deployed', bundle: recorded }]])));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).toHaveBeenCalledWith(recorded);
      expect(mockRecords.loadSaved).not.toHaveBeenCalled();
      expect(mockChannelService.getById).not.toHaveBeenCalled();
    });

    it('leaves a channel someone deployed while the server was starting as it is', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      register('a');

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).not.toHaveBeenCalled();
    });

    it('reads each channel\'s record just before deploying it, not once for all', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
      mockListAllDependencies.mockResolvedValue(ok([]));

      await DeploymentService.autoDeployChannels();

      expect(mockRecords.listRecorded.mock.calls).toEqual([[['a']], [['b']]]);
      expect(mockRecords.listRecorded.mock.invocationCallOrder[1]!).toBeGreaterThan(mockEngine.deploy.mock.invocationCallOrder[0]!);
    });

    it('does not record again what it redeploys at startup', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
      mockListAllDependencies.mockResolvedValue(ok([]));

      await DeploymentService.autoDeployChannels();

      expect(mockEngine.deploy).toHaveBeenCalledOnce();
      expect(mockRecords.record).not.toHaveBeenCalled();
    });

    it('leaves a channel someone undeployed undeployed', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([
        ['a', { kind: 'undeployed' }],
        ['b', { kind: 'deployed', bundle: bundle({ ...CHANNEL_DETAIL, id: 'b' }) }],
      ])));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(deployedOrder()).toEqual(['b']);
    });

    it('does not deploy an enabled channel that was never deployed, and audits it', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockRecords.listRecorded.mockResolvedValue(ok(new Map()));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(mockEngine.deploy).not.toHaveBeenCalled();
      expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'CHANNEL_NOT_REDEPLOYED', level: 'WARN', channelId: 'a' }));
    });

    it('does not deploy a channel the script watchdog holds, reports it, and deploys the others', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockRecords.listRecorded.mockImplementation(async ([id]: readonly string[]) => ok(new Map([
        [id, id === 'a' ? { kind: 'held', reason: 'A script of this channel was stuck.' } : { kind: 'deployed', bundle: bundle({ ...CHANNEL_DETAIL, id: 'b' }) }],
      ])));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(false);
      expect(result.error?.message).toBe('1 of 2 channels failed to redeploy: ch-a');
      expect(deployedOrder()).toEqual(['b']);
      expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'CHANNEL_NOT_REDEPLOYED', level: 'ERROR', outcome: 'FAILURE', channelId: 'a',
        attributes: { channelName: 'ch-a', reason: 'A script of this channel was stuck. Fix the script, then deploy the channel.' },
      }));
    });

    it('fails naming a channel whose record cannot be read, and deploys nothing from it', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockRecords.listRecorded.mockResolvedValue(ok(new Map([['a', { kind: 'unreadable', reason: 'its deployment record is missing channel.scriptTimeoutSeconds' }]])));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(false);
      expect(result.error?.message).toBe('1 of 1 channels failed to redeploy: ch-a');
      expect(mockEngine.deploy).not.toHaveBeenCalled();
      expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'CHANNEL_NOT_REDEPLOYED', level: 'ERROR', outcome: 'FAILURE' }));
    });

    describe('first start after the upgrade', () => {
      it('adopts the saved configuration of each enabled channel on the list, then deploys its record', async () => {
        mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a')]));
        mockListAllDependencies.mockResolvedValue(ok([]));
        mockRecords.listPendingAdoptions.mockResolvedValue(ok(new Set(['a'])));
        mockRecords.adoptSaved.mockResolvedValue(ok(bundle({ ...CHANNEL_DETAIL, id: 'a' })));

        const result = await DeploymentService.autoDeployChannels();

        expect(result.ok).toBe(true);
        expect(mockRecords.adoptSaved).toHaveBeenCalledWith('a');
        expect(mockRecords.adoptSaved.mock.invocationCallOrder[0]!).toBeLessThan(mockRecords.listRecorded.mock.invocationCallOrder[0]!);
        expect(deployedOrder()).toEqual(['a']);
        expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'CHANNEL_DEPLOYMENT_ADOPTED', channelId: 'a' }));
      });

      it('drops channels on the list that are no longer enabled, without adopting them', async () => {
        mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b', false)]));
        mockListAllDependencies.mockResolvedValue(ok([]));
        mockRecords.listPendingAdoptions.mockResolvedValue(ok(new Set(['a', 'b'])));
        mockRecords.adoptSaved.mockResolvedValue(ok(bundle({ ...CHANNEL_DETAIL, id: 'a' })));

        await DeploymentService.autoDeployChannels();

        expect(mockRecords.dropAdoptions).toHaveBeenCalledWith(['b']);
        expect(mockRecords.adoptSaved).toHaveBeenCalledTimes(1);
      });

      it('fails naming a channel it could not adopt, and still deploys the others', async () => {
        mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
        mockListAllDependencies.mockResolvedValue(ok([]));
        mockRecords.listPendingAdoptions.mockResolvedValue(ok(new Set(['a', 'b'])));
        mockRecords.adoptSaved.mockImplementation(async (id: string) => (id === 'a'
          ? { ok: false, value: null, error: new Error('db down') }
          : ok(bundle({ ...CHANNEL_DETAIL, id }))));

        const result = await DeploymentService.autoDeployChannels();

        expect(result.ok).toBe(false);
        expect(result.error?.message).toBe('1 of 2 channels failed to redeploy: ch-a');
        expect(deployedOrder()).toEqual(['b']);
      });
    });

    it('deploys dependencies before the channels that depend on them', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b'), summary('c')]));
      mockListAllDependencies.mockResolvedValue(ok([
        { channelId: 'a', dependsOnChannelId: 'b' },
        { channelId: 'b', dependsOnChannelId: 'c' },
      ]));

      await DeploymentService.autoDeployChannels();

      expect(deployedOrder()).toEqual(['c', 'b', 'a']);
    });

    it('deploys each live channel once, by id, when two share a name', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([
        { id: 'a', name: 'ADT', enabled: true },
        { id: 'b', name: 'ADT', enabled: true },
        { id: 'b', name: 'ADT', enabled: true },
      ]));
      mockListAllDependencies.mockResolvedValue(ok([]));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
      expect(deployedOrder()).toEqual(['a', 'b']);
      expect(mockChannelService.listLiveForDeploy).toHaveBeenCalledOnce();
    });

    it('skips disabled channels', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b', false)]));
      mockListAllDependencies.mockResolvedValue(ok([{ channelId: 'a', dependsOnChannelId: 'b' }]));

      await DeploymentService.autoDeployChannels();

      expect(deployedOrder()).toEqual(['a']);
    });

    it('deploys nothing when dependencies fail to load, since no safe order is known', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
      mockListAllDependencies.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });

      const result = await DeploymentService.autoDeployChannels();

      expect(deployedOrder()).toEqual([]);
      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('no channel was redeployed');
    });

    it('succeeds when every enabled channel redeploys', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b')]));
      mockListAllDependencies.mockResolvedValue(ok([]));

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(true);
    });

    it('fails with the database error when the channel list cannot load', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue({ ok: false, value: null, error: new Error('db down') });

      const result = await DeploymentService.autoDeployChannels();

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('db down');
    });

    it('deploys the other channels when one fails, then fails naming the one that did not deploy', async () => {
      mockChannelService.listLiveForDeploy.mockResolvedValue(ok([summary('a'), summary('b'), summary('c')]));
      mockListAllDependencies.mockResolvedValue(ok([]));
      mockEngine.deploy.mockImplementation(async (b: Bundle) => {
        if (b.channel.id === 'b') throw new Error('port in use');
      });

      const result = await DeploymentService.autoDeployChannels();

      expect(deployedOrder()).toEqual(['a', 'b', 'c']);
      expect(result.ok).toBe(false);
      expect(result.error?.message).toBe('1 of 3 channels failed to redeploy: ch-b');
    });
  });
});
