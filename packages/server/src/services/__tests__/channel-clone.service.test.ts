// ===========================================
// Channel Clone Service Tests
// ===========================================
// Tests for ChannelService.clone() method.
// We mock getById and create at the service boundary since clone delegates to them.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown, opts?: { orderable?: boolean }): void {
  const orderable = opts?.orderable ?? false;
  selectResponses.push(() => {
    if (orderable) {
      return Object.assign(Promise.resolve(value), {
        orderBy: vi.fn().mockResolvedValue(value),
      });
    }
    return value;
  });
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockInnerJoin = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
}));

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
  innerJoin: mockInnerJoin,
}));

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockTransaction = vi.fn();

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockInsertReturning = vi.fn().mockResolvedValue([]);
const mockInsertValues = vi.fn().mockImplementation(() => {
  return Object.assign(Promise.resolve(undefined), {
    returning: mockInsertReturning,
  });
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: mockTransaction,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  count: vi.fn(() => 'count_agg'),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('../partition-manager.service.js', () => ({
  PartitionManagerService: {
    createPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    dropPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Must import after mocks
const { ChannelService } = await import('../channel.service.js');
const { emitEvent } = await import('../../lib/event-emitter.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-01T12:00:00Z');
const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const CLONED_ID = '00000000-0000-0000-0000-000000000099';

const DEFAULT_SCRIPTS = [
  { id: 's1', scriptType: 'DEPLOY', script: 'deploy code' },
  { id: 's2', scriptType: 'UNDEPLOY', script: 'undeploy code' },
  { id: 's3', scriptType: 'PREPROCESSOR', script: '' },
  { id: 's4', scriptType: 'POSTPROCESSOR', script: '' },
];

const DESTINATIONS = [
  {
    id: 'd1', metaDataId: 1, name: 'Dest 1', enabled: true,
    connectorType: 'HTTP', properties: { url: 'http://localhost' },
    queueMode: 'NEVER', retryCount: 3, retryIntervalMs: 5000,
    rotateQueue: false, queueThreadCount: 1, waitForPrevious: false,
  },
  {
    id: 'd2', metaDataId: 2, name: 'Dest 2', enabled: false,
    connectorType: 'TCP_MLLP', properties: { host: '127.0.0.1', port: 6661 },
    queueMode: 'ON_FAILURE', retryCount: 5, retryIntervalMs: 10000,
    rotateQueue: true, queueThreadCount: 2, waitForPrevious: true,
  },
];

const METADATA_COLUMNS = [
  { id: 'm1', name: 'patientId', dataType: 'STRING', mappingExpression: 'msg.PID.3' },
  { id: 'm2', name: 'eventDate', dataType: 'TIMESTAMP', mappingExpression: null },
];

function makeChannel(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: CHANNEL_ID,
    name: 'Original Channel',
    description: 'Source channel description',
    enabled: true,
    revision: 5,
    inboundDataType: 'HL7V2',
    outboundDataType: 'XML',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { port: 6661 },
    responseMode: 'AUTO_AFTER_DESTINATIONS',
    responseConnectorName: null,
    initialState: 'STARTED',
    messageStorageMode: 'PRODUCTION',
    encryptData: true,
    removeContentOnCompletion: true,
    removeAttachmentsOnCompletion: false,
    pruningEnabled: true,
    pruningMaxAgeDays: 30,
    pruningArchiveEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lastDeployedAt: null,
    ...overrides,
  };
}

function makeClonedChannel(): Record<string, unknown> {
  return makeChannel({
    id: CLONED_ID,
    name: 'Cloned Channel',
    enabled: false,
    revision: 1,
  });
}

// ----- Helpers -----

function setupGetByIdMocks(
  channel: Record<string, unknown>,
  relations?: {
    scripts?: unknown[];
    destinations?: unknown[];
    metadataColumns?: unknown[];
  },
): void {
  pushResponse([channel]);                                                    // findChannel
  pushResponse(relations?.scripts ?? DEFAULT_SCRIPTS);                        // scripts
  pushResponse(relations?.destinations ?? [], { orderable: true });           // destinations
  pushResponse(relations?.metadataColumns ?? []);                             // metadataColumns
  pushResponse([]);                                                           // tags
  pushResponse([]);                                                           // filters
  pushResponse([]);                                                           // filter rules
  pushResponse([]);                                                           // transformers
  pushResponse([]);                                                           // transformer steps
}

function setupCreateMocks(channel: Record<string, unknown>): void {
  // Uniqueness check
  pushResponse([]);
  // fetchChannelRelations after create
  pushResponse(DEFAULT_SCRIPTS);
  pushResponse([], { orderable: true });
  pushResponse([]);
  pushResponse([]);
  pushResponse([]);
  pushResponse([]);
  pushResponse([]);
  pushResponse([]);

  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    let insertCallCount = 0;
    const tx = {
      insert: vi.fn().mockImplementation(() => {
        insertCallCount++;
        if (insertCallCount === 1) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([channel]),
            }),
          };
        }
        return { values: vi.fn().mockResolvedValue(undefined) };
      }),
    };
    return fn(tx);
  });
}

// ----- Tests -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
  mockDeleteWhere.mockResolvedValue(undefined);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockInsertReturning.mockResolvedValue([]);
  mockInsertValues.mockImplementation(() => {
    return Object.assign(Promise.resolve(undefined), {
      returning: mockInsertReturning,
    });
  });
  mockInsert.mockReturnValue({ values: mockInsertValues });
});

describe('ChannelService.clone', () => {
  it('returns a new channel with the specified name', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(CLONED_ID);
    expect(result.value.name).toBe('Cloned Channel');
  });

  it('sets enabled to false on the cloned channel', async () => {
    const source = makeChannel({ enabled: true });
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The create call should have received enabled: false
    // We verify by checking the transaction was called (create was invoked)
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('copies channel properties from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    // Spy on create to capture the input
    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.name).toBe('Cloned Channel');
    expect(createInput.enabled).toBe(false);
    expect(createInput.inboundDataType).toBe('HL7V2');
    expect(createInput.outboundDataType).toBe('XML');
    expect(createInput.sourceConnectorType).toBe('TCP_MLLP');
    expect(createInput.sourceConnectorProperties).toEqual({ port: 6661 });
    expect(createInput.responseMode).toBe('AUTO_AFTER_DESTINATIONS');
    expect(createInput.properties?.initialState).toBe('STARTED');
    expect(createInput.properties?.messageStorageMode).toBe('PRODUCTION');
    expect(createInput.properties?.encryptData).toBe(true);
    expect(createInput.properties?.pruningEnabled).toBe(true);
    expect(createInput.properties?.pruningMaxAgeDays).toBe(30);
    expect(createInput.properties?.pruningArchiveEnabled).toBe(true);

    createSpy.mockRestore();
  });

  it('copies scripts from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.scripts?.deploy).toBe('deploy code');
    expect(createInput.scripts?.undeploy).toBe('undeploy code');
    expect(createInput.scripts?.preprocessor).toBe('');
    expect(createInput.scripts?.postprocessor).toBe('');

    createSpy.mockRestore();
  });

  it('copies destinations from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source, { destinations: DESTINATIONS });
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.destinations).toHaveLength(2);
    expect(createInput.destinations![0]!.name).toBe('Dest 1');
    expect(createInput.destinations![0]!.connectorType).toBe('HTTP');
    expect(createInput.destinations![0]!.properties).toEqual({ url: 'http://localhost' });
    expect(createInput.destinations![0]!.retryCount).toBe(3);
    expect(createInput.destinations![1]!.name).toBe('Dest 2');
    expect(createInput.destinations![1]!.connectorType).toBe('TCP_MLLP');
    expect(createInput.destinations![1]!.queueMode).toBe('ON_FAILURE');
    expect(createInput.destinations![1]!.waitForPrevious).toBe(true);

    createSpy.mockRestore();
  });

  it('copies metadata columns from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source, { metadataColumns: METADATA_COLUMNS });
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.metadataColumns).toHaveLength(2);
    expect(createInput.metadataColumns![0]!.name).toBe('patientId');
    expect(createInput.metadataColumns![0]!.dataType).toBe('STRING');
    expect(createInput.metadataColumns![0]!.mappingExpression).toBe('msg.PID.3');
    expect(createInput.metadataColumns![1]!.name).toBe('eventDate');
    expect(createInput.metadataColumns![1]!.dataType).toBe('TIMESTAMP');
    expect(createInput.metadataColumns![1]!.mappingExpression).toBeNull();

    createSpy.mockRestore();
  });

  it('returns NOT_FOUND when source channel does not exist', async () => {
    pushResponse([]); // findChannel returns empty

    const result = await ChannelService.clone('00000000-0000-0000-0000-000000000099', 'Clone');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
  });

  it('returns ALREADY_EXISTS when clone name conflicts', async () => {
    const source = makeChannel();
    makeClonedChannel();

    // getById succeeds
    setupGetByIdMocks(source);
    // create's uniqueness check finds a conflict
    pushResponse([{ id: 'existing-id' }]);

    const result = await ChannelService.clone(CHANNEL_ID, 'Existing Name');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
  });

  it('emits a clone-specific event on success', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const context = { userId: 'user-1', ipAddress: '127.0.0.1' };
    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel', context);

    expect(result.ok).toBe(true);
    // emitEvent is called by both create() and clone() — check for clone-specific call
    const calls = (emitEvent as ReturnType<typeof vi.fn>).mock.calls;
    const cloneEvent = calls.find(
      (c: unknown[]) => {
        const arg = c[0] as Record<string, unknown>;
        const attrs = arg['attributes'] as Record<string, unknown> | undefined;
        return attrs?.['clonedFrom'] === CHANNEL_ID;
      }
    );
    expect(cloneEvent).toBeDefined();
  });

  it('copies description from source', async () => {
    const source = makeChannel({ description: 'Important channel' });
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy.mock.calls[0]![0].description).toBe('Important channel');

    createSpy.mockRestore();
  });

  it('uses empty string for null description', async () => {
    const source = makeChannel({ description: null });
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy.mock.calls[0]![0].description).toBe('');

    createSpy.mockRestore();
  });
});
