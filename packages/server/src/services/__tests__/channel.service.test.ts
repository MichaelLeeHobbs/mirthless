import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdError } from 'stderr-lib';
import { PartitionManagerService } from '../partition-manager.service.js';

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown, opts?: { chainable?: boolean; orderable?: boolean }): void {
  const chainable = opts?.chainable ?? false;
  const orderable = opts?.orderable ?? false;
  selectResponses.push(() => {
    if (chainable) {
      return Object.assign(Promise.resolve(value), {
        orderBy: () => ({
          limit: () => ({
            offset: vi.fn().mockResolvedValue(value),
          }),
        }),
      });
    }
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
  sql: vi.fn((strings: TemplateStringsArray) => ({ type: 'sql', text: strings.join('?') })),
}));

const mockEmitEvent = vi.fn();
vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: mockEmitEvent,
}));

// Placing a new channel in a group is covered against Postgres (create-in-scope.itest.ts).
vi.mock('../grant.service.js', () => ({ GrantService: { placeNewChannel: vi.fn().mockResolvedValue(null), newChannelGroup: vi.fn().mockResolvedValue(null) } }));

vi.mock('../partition-manager.service.js', () => ({
  PartitionManagerService: {
    createPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    dropPartitions: vi.fn().mockResolvedValue({ ok: true, value: undefined, error: null }),
    partitionExists: vi.fn().mockResolvedValue({ ok: true, value: false, error: null }),
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

const NOW = new Date('2026-02-26T12:00:00Z');

function makeChannel(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Channel',
    description: 'A test channel',
    enabled: false,
    revision: 1,
    inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: { port: 6661 },
    responseMode: 'AUTO_AFTER_DESTINATIONS',
    responseConnectorName: null,
    initialState: 'STOPPED',
    messageStorageMode: 'DEVELOPMENT',
    encryptData: false,
    removeContentOnCompletion: false,
    removeAttachmentsOnCompletion: false,
    pruningEnabled: false,
    pruningMaxAgeDays: null,
    pruningArchiveEnabled: false,
    scriptTimeoutSeconds: 30,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    lastDeployedAt: null,
    ...overrides,
  };
}

const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_SCRIPTS = [
  { id: 's1', scriptType: 'DEPLOY', script: '' },
  { id: 's2', scriptType: 'UNDEPLOY', script: '' },
  { id: 's3', scriptType: 'PREPROCESSOR', script: '' },
  { id: 's4', scriptType: 'POSTPROCESSOR', script: '' },
];

const CREATE_INPUT = {
  name: 'Test Channel',
  description: 'A test channel',
  enabled: false,
  inboundDataType: 'HL7V2' as const,
  outboundDataType: 'HL7V2' as const,
  sourceConnectorType: 'TCP_MLLP' as const,
  sourceConnectorProperties: { port: 6661 },
  responseMode: 'AUTO_AFTER_DESTINATIONS' as const,
};

function setupGetByIdMocks(
  channel: Record<string, unknown>,
  relations?: {
    destinations?: unknown[];
    metadataColumns?: unknown[];
    filters?: unknown[];
    filterRulesData?: unknown[];
    transformers?: unknown[];
    transformerStepsData?: unknown[];
  },
): void {
  pushResponse([channel]);
  pushResponse(DEFAULT_SCRIPTS);
  pushResponse(relations?.destinations ?? [], { orderable: true });
  pushResponse(relations?.metadataColumns ?? []);
  pushResponse([]);
  pushResponse(relations?.filters ?? []);
  pushResponse(relations?.filterRulesData ?? []);
  pushResponse(relations?.transformers ?? []);
  pushResponse(relations?.transformerStepsData ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  // Awaited directly (delete/setEnabled) and chained with .returning() (update's optimistic lock).
  mockUpdateWhere.mockImplementation(() =>
    Object.assign(Promise.resolve(undefined), {
      returning: vi.fn().mockResolvedValue([{ id: CHANNEL_ID }]),
    }),
  );
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
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

describe('ChannelService', () => {
  describe('list', () => {
    it('returns paginated results', async () => {
      const channel = makeChannel();
      pushResponse([channel], { chainable: true });
      pushResponse([{ total: 1 }]);

      const result = await ChannelService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(1);
      expect(result.value.data[0]!.name).toBe('Test Channel');
      expect(result.value.pagination).toEqual({
        page: 1,
        pageSize: 25,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns empty list when no channels exist', async () => {
      pushResponse([], { chainable: true });
      pushResponse([{ total: 0 }]);

      const result = await ChannelService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(0);
      expect(result.value.pagination.total).toBe(0);
      expect(result.value.pagination.totalPages).toBe(0);
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB connection failed');
      });

      const result = await ChannelService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(false);
    });
  });

  describe('listLiveForDeploy', () => {
    it('returns every live channel in one query, ordered by id (#259)', async () => {
      const rows = [{ id: 'a', name: 'ADT', enabled: true }, { id: 'b', name: 'ADT', enabled: false }];
      pushResponse(rows, { orderable: true });

      const result = await ChannelService.listLiveForDeploy();

      expect(result).toEqual({ ok: true, value: rows, error: null });
      expect(mockSelect).toHaveBeenCalledOnce();
    });

    it('returns the error when the query fails', async () => {
      selectResponses.push(() => { throw new Error('DB down'); });

      const result = await ChannelService.listLiveForDeploy();

      expect(result.ok).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns channel detail with relations', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel);

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(CHANNEL_ID);
      expect(result.value.name).toBe('Test Channel');
      expect(result.value.scripts).toHaveLength(4);
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.getById('00000000-0000-0000-0000-000000000099');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns NOT_FOUND for soft-deleted channel', async () => {
      // The query's isNull(deletedAt) filters a soft-deleted channel out.
      pushResponse([]);

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB timeout');
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(false);
    });
  });

  describe('create', () => {
    it('creates channel with default scripts', async () => {
      const channel = makeChannel();

      pushResponse([]);
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

      const result = await ChannelService.create(CREATE_INPUT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('Test Channel');
      expect(result.value.scripts).toHaveLength(4);
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    /** A transaction whose channel insert returns `channel`; `rejected` says whether its callback threw. */
    function channelTx(channel: Record<string, unknown>): { readonly tx: { insert: ReturnType<typeof vi.fn> }; readonly rejected: () => boolean } {
      let threw = false;
      const tx = {
        insert: vi.fn().mockImplementation(() => (
          { values: vi.fn().mockReturnValue(Object.assign(Promise.resolve(undefined), { returning: vi.fn().mockResolvedValue([channel]) })) }
        )),
      };
      mockTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        try {
          return await fn(tx);
        } catch (err) {
          threw = true;
          throw err;
        }
      });
      return { tx, rejected: () => threw };
    }

    it('creates the partitions on the transaction that wrote the channel, after writing it (#260)', async () => {
      pushResponse([]);
      const channel = makeChannel();
      const { tx } = channelTx(channel);

      await ChannelService.create(CREATE_INPUT);

      expect(PartitionManagerService.createPartitions).toHaveBeenCalledWith(channel['id'], tx);
      // Last statement in the transaction: it locks the six message tables until commit.
      const lastInsert = tx.insert.mock.invocationCallOrder[tx.insert.mock.invocationCallOrder.length - 1]!;
      expect(lastInsert).toBeLessThan(vi.mocked(PartitionManagerService.createPartitions).mock.invocationCallOrder[0]!);
    });

    it('fails, rolling the channel back, when its partitions cannot be created (#260)', async () => {
      pushResponse([]);
      const { rejected } = channelTx(makeChannel());
      vi.mocked(PartitionManagerService.createPartitions)
        .mockResolvedValueOnce({ ok: false, value: null, error: new StdError('permission denied for table messages') });

      const result = await ChannelService.create(CREATE_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INTERNAL');
      expect(result.error.message).toBe(
        'Channel "Test Channel" was not created: its message partitions could not be created: permission denied for table messages',
      );
      // The transaction callback threw, so Postgres rolls the channel row back.
      expect(rejected()).toBe(true);
    });

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: 'existing-id' }]);

      const result = await ChannelService.create(CREATE_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('DB down');
      });

      const result = await ChannelService.create(CREATE_INPUT);

      expect(result.ok).toBe(false);
    });
  });

  describe('update', () => {
    it('updates channel and bumps revision', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2, name: 'Updated Channel' });

      pushResponse([channel]);
      pushResponse([]);
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.update(CHANNEL_ID, {
        name: 'Updated Channel',
        revision: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('Updated Channel');
      expect(result.value.revision).toBe(2);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.update('00000000-0000-0000-0000-000000000099', {
        name: 'X',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns CONFLICT when revision mismatch', async () => {
      const channel = makeChannel({ revision: 5 });
      pushResponse([channel]);

      const result = await ChannelService.update(CHANNEL_ID, {
        name: 'X',
        revision: 3,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
      expect(result.error).toHaveProperty('details', {
        currentRevision: 5,
        providedRevision: 3,
      });
    });

    it('returns error on DB failure', async () => {
      selectResponses.push(() => {
        throw new Error('Connection lost');
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        name: 'X',
        revision: 1,
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('delete', () => {
    it('soft-deletes channel by setting deletedAt', async () => {
      const channel = makeChannel();
      pushResponse([channel]);

      const result = await ChannelService.delete(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) })
      );
      // A soft delete must NOT destroy message history (HIPAA retention).
      expect(PartitionManagerService.dropPartitions).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.delete('00000000-0000-0000-0000-000000000099');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('setEnabled', () => {
    it('toggles enabled flag and returns detail', async () => {
      const channel = makeChannel({ enabled: false });
      const updatedChannel = makeChannel({ enabled: true });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.setEnabled(CHANNEL_ID, true);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('raises the revision, so an editor opened before the change cannot save the old flag back', async () => {
      pushResponse([makeChannel({ enabled: false })]);
      setupGetByIdMocks(makeChannel({ enabled: true }));

      await ChannelService.setEnabled(CHANNEL_ID, true);

      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, revision: expect.objectContaining({ type: 'sql' }) }));
    });

    it('records who enabled or disabled the channel', async () => {
      pushResponse([makeChannel({ enabled: true })]);
      setupGetByIdMocks(makeChannel({ enabled: false }));

      await ChannelService.setEnabled(CHANNEL_ID, false, { userId: 'user-1', ipAddress: '10.0.0.1' });

      expect(mockEmitEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'CHANNEL_DISABLED', userId: 'user-1', channelId: CHANNEL_ID }));
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.setEnabled('00000000-0000-0000-0000-000000000099', true);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('update — destinations sync', () => {
    const DEST_ROWS = [
      {
        id: 'd1',
        metaDataId: 1,
        name: 'Dest 1',
        enabled: true,
        connectorType: 'TCP_MLLP',
        properties: { host: 'lab', port: 6661 },
        queueMode: 'NEVER',
        retryCount: 0,
        retryIntervalMs: 10000,
        rotateQueue: false,
        queueThreadCount: 1,
        waitForPrevious: false,
      },
    ];

    it('syncs destinations via delete-and-reinsert on update', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel, { destinations: DEST_ROWS });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        destinations: [
          {
            name: 'Dest 1',
            enabled: true,
            connectorType: 'TCP_MLLP' as const,
            properties: { host: 'lab', port: 6661 },
            queueMode: 'NEVER' as const,
            retryCount: 0,
            retryIntervalMs: 10000,
            rotateQueue: false,
            queueThreadCount: 1,
            waitForPrevious: false,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.destinations).toHaveLength(1);
      expect(result.value.destinations[0]!.name).toBe('Dest 1');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('removes all destinations when empty array provided', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        destinations: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.destinations).toHaveLength(0);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('update — transaction & atomic optimistic lock', () => {
    it('returns CONFLICT when the atomic UPDATE affects 0 rows (concurrent writer won)', async () => {
      const channel = makeChannel({ revision: 1 });
      pushResponse([channel]);
      mockUpdateWhere.mockImplementationOnce(() =>
        Object.assign(Promise.resolve(undefined), {
          returning: vi.fn().mockResolvedValue([]),
        }),
      );

      const result = await ChannelService.update(CHANNEL_ID, { revision: 1, enabled: true });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });

    it('wraps mutations in a transaction and fails the whole update if one step throws (rollback)', async () => {
      const channel = makeChannel({ revision: 1 });
      pushResponse([channel]);
      mockTransaction.mockImplementationOnce(async () => {
        throw new Error('insert failed mid-update');
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        destinations: [],
      });

      expect(result.ok).toBe(false);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('encryptData is accepted and persisted', () => {
    it('accepts create with encryptData enabled and writes the flag', async () => {
      const channel = makeChannel();
      let channelInsertValues: Record<string, unknown> | null = null;

      pushResponse([]);
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
                values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
                  channelInsertValues = v;
                  return { returning: vi.fn().mockResolvedValue([channel]) };
                }),
              };
            }
            return { values: vi.fn().mockResolvedValue(undefined) };
          }),
        };
        return fn(tx);
      });

      const result = await ChannelService.create({
        ...CREATE_INPUT,
        properties: {
          initialState: 'STOPPED',
          messageStorageMode: 'DEVELOPMENT',
          encryptData: true,
          removeContentOnCompletion: false,
          removeAttachmentsOnCompletion: false,
          pruningEnabled: false,
          pruningMaxAgeDays: null,
          pruningArchiveEnabled: false,
        },
      } as unknown as Parameters<typeof ChannelService.create>[0]);

      expect(result.ok).toBe(true);
      expect(channelInsertValues).not.toBeNull();
      expect(channelInsertValues!['encryptData']).toBe(true);
    });

    it('accepts update with encryptData enabled and writes the flag', async () => {
      const channel = makeChannel();
      pushResponse([{ ...channel, revision: 1 }]);
      setupGetByIdMocks({ ...channel, encryptData: true });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        properties: {
          initialState: 'STOPPED',
          messageStorageMode: 'DEVELOPMENT',
          encryptData: true,
          removeContentOnCompletion: false,
          removeAttachmentsOnCompletion: false,
          pruningEnabled: false,
          pruningMaxAgeDays: null,
          pruningArchiveEnabled: false,
        },
      } as unknown as Parameters<typeof ChannelService.update>[1]);

      expect(result.ok).toBe(true);
      const setArg = mockSet.mock.calls.find((c) => (c[0] as Record<string, unknown>)['encryptData'] === true);
      expect(setArg).toBeDefined();
    });
  });

  // #183: a request that leaves a channel script's language out keeps the stored
  // one instead of writing JavaScript over a TypeScript script.
  describe('update — channel script languages', () => {
    function scriptSets(): Array<Record<string, unknown>> {
      return mockSet.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((v) => 'script' in v);
    }

    it('keeps the stored language when the request leaves it out', async () => {
      const channel = makeChannel();
      pushResponse([channel]);
      setupGetByIdMocks(makeChannel({ revision: 2 }));

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        scripts: { deploy: 'return;', undeploy: null, preprocessor: null, postprocessor: null, languages: {} },
      });

      expect(result.ok).toBe(true);
      // Strict: a `language: undefined` key would still write the language.
      expect(scriptSets()).toStrictEqual([{ script: 'return;' }, { script: '' }, { script: '' }, { script: '' }]);
    });

    it('writes the language the request gives', async () => {
      const channel = makeChannel();
      pushResponse([channel]);
      setupGetByIdMocks(makeChannel({ revision: 2 }));

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        scripts: { deploy: 'return;', undeploy: null, preprocessor: null, postprocessor: null, languages: { deploy: 'TYPESCRIPT' } },
      });

      expect(result.ok).toBe(true);
      expect(scriptSets()).toEqual([{ script: 'return;', language: 'TYPESCRIPT' }, { script: '' }, { script: '' }, { script: '' }]);
    });
  });

  describe('getById — pruning fields', () => {
    it('returns pruning fields in channel detail', async () => {
      const channel = makeChannel({
        pruningEnabled: true,
        pruningMaxAgeDays: 30,
        pruningArchiveEnabled: true,
      });
      setupGetByIdMocks(channel);

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pruningEnabled).toBe(true);
      expect(result.value.pruningMaxAgeDays).toBe(30);
      expect(result.value.pruningArchiveEnabled).toBe(true);
    });

    it('returns removeContent/removeAttachments fields', async () => {
      const channel = makeChannel({
        removeContentOnCompletion: true,
        removeAttachmentsOnCompletion: true,
      });
      setupGetByIdMocks(channel);

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.removeContentOnCompletion).toBe(true);
      expect(result.value.removeAttachmentsOnCompletion).toBe(true);
    });
  });

  describe('create — with destinations', () => {
    it('creates channel with destinations', async () => {
      const channel = makeChannel();
      const destRows = [
        {
          id: 'd1',
          metaDataId: 1,
          name: 'Dest 1',
          enabled: true,
          connectorType: 'TCP_MLLP',
          properties: { host: 'lab', port: 6661 },
          queueMode: 'NEVER',
          retryCount: 0,
          retryIntervalMs: 10000,
          rotateQueue: false,
          queueThreadCount: 1,
          waitForPrevious: false,
        },
      ];

      pushResponse([]);
      pushResponse(DEFAULT_SCRIPTS);
      pushResponse(destRows, { orderable: true });
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
            const rows = insertCallCount === 1 ? [channel] : [];
            return {
              values: vi.fn().mockReturnValue(
                Object.assign(Promise.resolve(rows), {
                  returning: vi.fn().mockResolvedValue(rows),
                }),
              ),
            };
          }),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        };
        return fn(tx);
      });

      const result = await ChannelService.create({
        ...CREATE_INPUT,
        destinations: [
          {
            name: 'Dest 1',
            enabled: true,
            connectorType: 'TCP_MLLP' as const,
            properties: { host: 'lab', port: 6661 },
            queueMode: 'NEVER' as const,
            retryCount: 0,
            retryIntervalMs: 10000,
            rotateQueue: false,
            queueThreadCount: 1,
            waitForPrevious: false,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.destinations).toHaveLength(1);
      expect(result.value.destinations[0]!.name).toBe('Dest 1');
    });
  });

  describe('getById — filters and transformers', () => {
    it('returns source filter with rules', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel, {
        filters: [{ id: 'f1', connectorId: null }],
        filterRulesData: [
          {
            id: 'r1',
            filterId: 'f1',
            sequenceNumber: 0,
            enabled: true,
            name: 'Check ADT',
            operator: 'AND',
            type: 'JAVASCRIPT',
            script: 'return true;',
            field: null,
            condition: null,
            values: null,
          },
        ],
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toHaveLength(1);
      expect(result.value.filters[0]!.connectorId).toBeNull();
      expect(result.value.filters[0]!.rules).toHaveLength(1);
      expect(result.value.filters[0]!.rules[0]!.name).toBe('Check ADT');
    });

    it('returns destination filter with connector ID', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel, {
        destinations: [
          {
            id: 'd1', metaDataId: 1, name: 'Dest 1', enabled: true,
            connectorType: 'TCP_MLLP', properties: {}, queueMode: 'NEVER',
            retryCount: 0, retryIntervalMs: 10000, rotateQueue: false,
            queueThreadCount: 1, waitForPrevious: false,
          },
        ],
        filters: [{ id: 'f1', connectorId: 'd1' }],
        filterRulesData: [
          {
            id: 'r1', filterId: 'f1', sequenceNumber: 0, enabled: true,
            name: null, operator: 'OR', type: 'RULE_BUILDER',
            script: null, field: 'MSH.9', condition: 'EQUALS', values: ['ADT'],
          },
        ],
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toHaveLength(1);
      expect(result.value.filters[0]!.connectorId).toBe('d1');
      expect(result.value.filters[0]!.rules[0]!.type).toBe('RULE_BUILDER');
      expect(result.value.filters[0]!.rules[0]!.values).toEqual(['ADT']);
    });

    it('returns source transformer with steps', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel, {
        transformers: [{
          id: 't1', connectorId: null,
          inboundDataType: 'HL7V2', outboundDataType: 'JSON',
          inboundProperties: {}, outboundProperties: {},
          inboundTemplate: null, outboundTemplate: null,
        }],
        transformerStepsData: [
          {
            id: 'ts1', transformerId: 't1', sequenceNumber: 0,
            enabled: true, name: 'Convert to JSON', type: 'JAVASCRIPT',
            script: 'return JSON.stringify(msg);',
            sourceField: null, targetField: null, defaultValue: null, mapping: null,
          },
        ],
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transformers).toHaveLength(1);
      expect(result.value.transformers[0]!.connectorId).toBeNull();
      expect(result.value.transformers[0]!.inboundDataType).toBe('HL7V2');
      expect(result.value.transformers[0]!.outboundDataType).toBe('JSON');
      expect(result.value.transformers[0]!.steps).toHaveLength(1);
      expect(result.value.transformers[0]!.steps[0]!.name).toBe('Convert to JSON');
    });

    it('returns empty arrays when no filters or transformers exist', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel);

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toEqual([]);
      expect(result.value.transformers).toEqual([]);
    });

    it('sorts rules by sequence number', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel, {
        filters: [{ id: 'f1', connectorId: null }],
        filterRulesData: [
          {
            id: 'r2', filterId: 'f1', sequenceNumber: 1, enabled: true,
            name: 'Second', operator: 'AND', type: 'JAVASCRIPT',
            script: null, field: null, condition: null, values: null,
          },
          {
            id: 'r1', filterId: 'f1', sequenceNumber: 0, enabled: true,
            name: 'First', operator: 'AND', type: 'JAVASCRIPT',
            script: null, field: null, condition: null, values: null,
          },
        ],
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters[0]!.rules[0]!.name).toBe('First');
      expect(result.value.filters[0]!.rules[1]!.name).toBe('Second');
    });

    it('sorts transformer steps by sequence number', async () => {
      const channel = makeChannel();
      setupGetByIdMocks(channel, {
        transformers: [{
          id: 't1', connectorId: null,
          inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
          inboundProperties: {}, outboundProperties: {},
          inboundTemplate: null, outboundTemplate: null,
        }],
        transformerStepsData: [
          {
            id: 'ts2', transformerId: 't1', sequenceNumber: 1, enabled: true,
            name: 'Step B', type: 'JAVASCRIPT', script: null,
            sourceField: null, targetField: null, defaultValue: null, mapping: null,
          },
          {
            id: 'ts1', transformerId: 't1', sequenceNumber: 0, enabled: true,
            name: 'Step A', type: 'MAPPER', script: null,
            sourceField: 'PID.3', targetField: 'id', defaultValue: '', mapping: 'COPY',
          },
        ],
      });

      const result = await ChannelService.getById(CHANNEL_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transformers[0]!.steps[0]!.name).toBe('Step A');
      expect(result.value.transformers[0]!.steps[1]!.name).toBe('Step B');
    });
  });

  describe('update — filter/transformer sync', () => {
    it('persists source filter rules on update', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel, {
        filters: [{ id: 'f1', connectorId: null }],
        filterRulesData: [
          {
            id: 'r1', filterId: 'f1', sequenceNumber: 0, enabled: true,
            name: 'JS Filter', operator: 'AND', type: 'JAVASCRIPT',
            script: 'return true;', field: null, condition: null, values: null,
          },
        ],
      });

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'f1' }]),
        }),
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        filters: [{
          connectorId: null, metaDataId: null,
          rules: [{
            enabled: true,
            operator: 'AND',
            type: 'JAVASCRIPT',
            script: 'return true;',
            field: null,
            condition: null,
            values: null,
          }],
        }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toHaveLength(1);
      expect(result.value.filters[0]!.rules).toHaveLength(1);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('persists source transformer steps on update', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel, {
        transformers: [{
          id: 't1', connectorId: null,
          inboundDataType: 'HL7V2', outboundDataType: 'JSON',
          inboundProperties: {}, outboundProperties: {},
          inboundTemplate: null, outboundTemplate: null,
        }],
        transformerStepsData: [
          {
            id: 'ts1', transformerId: 't1', sequenceNumber: 0, enabled: true,
            name: 'Map PID', type: 'MAPPER', script: null,
            sourceField: 'PID.3', targetField: 'id', defaultValue: '', mapping: 'COPY',
          },
        ],
      });

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 't1' }]),
        }),
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        transformers: [{
          connectorId: null, metaDataId: null,
          inboundDataType: 'HL7V2',
          outboundDataType: 'JSON',
          inboundProperties: {},
          outboundProperties: {},
          inboundTemplate: null,
          outboundTemplate: null,
          steps: [{
            enabled: true,
            type: 'MAPPER',
            script: null,
            sourceField: 'PID.3',
            targetField: 'id',
            defaultValue: '',
            mapping: 'COPY',
          }],
        }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transformers).toHaveLength(1);
      expect(result.value.transformers[0]!.steps).toHaveLength(1);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('clears filters when empty array provided', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        filters: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toEqual([]);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('clears transformers when empty array provided', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        transformers: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transformers).toEqual([]);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('handles filter with empty rules', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel, {
        filters: [{ id: 'f1', connectorId: null }],
        filterRulesData: [],
      });

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'f1' }]),
        }),
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        filters: [{ connectorId: null, metaDataId: null, rules: [] }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filters).toHaveLength(1);
      expect(result.value.filters[0]!.rules).toHaveLength(0);
    });

    it('handles transformer with empty steps', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      pushResponse([channel]);
      setupGetByIdMocks(updatedChannel, {
        transformers: [{
          id: 't1', connectorId: null,
          inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
          inboundProperties: {}, outboundProperties: {},
          inboundTemplate: null, outboundTemplate: null,
        }],
        transformerStepsData: [],
      });

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 't1' }]),
        }),
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        transformers: [{
          connectorId: null, metaDataId: null,
          inboundDataType: 'HL7V2',
          outboundDataType: 'HL7V2',
          inboundProperties: {},
          outboundProperties: {},
          inboundTemplate: null,
          outboundTemplate: null,
          steps: [],
        }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.transformers).toHaveLength(1);
      expect(result.value.transformers[0]!.steps).toHaveLength(0);
    });
  });
});
