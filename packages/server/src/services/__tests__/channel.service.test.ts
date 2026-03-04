// ===========================================
// Channel Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----
// We mock at the db module boundary per CLAUDE.md rules.
// Each chain call is tracked via mockImplementation so Promise.all works correctly.

// Shared state for mock call tracking
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
      // Return value that also supports .orderBy() chain (for list pagination)
      return Object.assign(Promise.resolve(value), {
        orderBy: () => ({
          limit: () => ({
            offset: vi.fn().mockResolvedValue(value),
          }),
        }),
      });
    }
    if (orderable) {
      // Return value that supports .orderBy() chain (for destinations)
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
  // Support both .returning() chain and direct resolution
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

// Mock drizzle-orm operators to be pass-through
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

// ----- Fixtures -----

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

// ----- Helpers -----

/**
 * Set up mocks for getById flow: findChannel + 8 parallel relation queries.
 */
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
  pushResponse([channel]);                                                    // findChannel
  pushResponse(DEFAULT_SCRIPTS);                                              // scripts
  pushResponse(relations?.destinations ?? [], { orderable: true });           // destinations (has .orderBy)
  pushResponse(relations?.metadataColumns ?? []);                             // metadataColumns
  pushResponse([]);                                                           // tags (via innerJoin)
  pushResponse(relations?.filters ?? []);                                     // filters
  pushResponse(relations?.filterRulesData ?? []);                             // filter rules (via innerJoin)
  pushResponse(relations?.transformers ?? []);                                // transformers
  pushResponse(relations?.transformerStepsData ?? []);                        // transformer steps (via innerJoin)
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

describe('ChannelService', () => {
  // ========== LIST ==========
  describe('list', () => {
    it('returns paginated results', async () => {
      const channel = makeChannel();
      // First query: paginated select (goes through orderBy chain)
      pushResponse([channel], { chainable: true });
      // Second query: count
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

  // ========== GET BY ID ==========
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
      pushResponse([]); // findChannel returns empty

      const result = await ChannelService.getById('00000000-0000-0000-0000-000000000099');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns NOT_FOUND for soft-deleted channel', async () => {
      // The SQL filter `isNull(deletedAt)` means deleted channels return empty
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

  // ========== CREATE ==========
  describe('create', () => {
    it('creates channel with default scripts', async () => {
      const channel = makeChannel();

      // 1. Uniqueness check → no duplicate
      pushResponse([]);
      // After transaction, fetchChannelRelations is called directly (no findChannel)
      pushResponse(DEFAULT_SCRIPTS);                     // scripts
      pushResponse([], { orderable: true });             // destinations (has .orderBy)
      pushResponse([]);                                  // metadataColumns
      pushResponse([]);                                  // tags
      pushResponse([]);                                  // filters
      pushResponse([]);                                  // filter rules
      pushResponse([]);                                  // transformers
      pushResponse([]);                                  // transformer steps

      // Transaction mock
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        let insertCallCount = 0;
        const tx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++;
            if (insertCallCount === 1) {
              // Channel insert
              return {
                values: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([channel]),
                }),
              };
            }
            // Scripts insert
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

    it('returns ALREADY_EXISTS for duplicate name', async () => {
      pushResponse([{ id: 'existing-id' }]); // uniqueness check finds existing

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

  // ========== UPDATE ==========
  describe('update', () => {
    it('updates channel and bumps revision', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2, name: 'Updated Channel' });

      // 1. findChannel (existing check)
      pushResponse([channel]);
      // 2. Name uniqueness check (name is changing) → no duplicate
      pushResponse([]);
      // 3. After db.update, findChannel again + fetchChannelRelations
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

  // ========== DELETE ==========
  describe('delete', () => {
    it('soft-deletes channel by setting deletedAt', async () => {
      const channel = makeChannel();
      pushResponse([channel]); // findChannel

      const result = await ChannelService.delete(CHANNEL_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) })
      );
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.delete('00000000-0000-0000-0000-000000000099');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // ========== SET ENABLED ==========
  describe('setEnabled', () => {
    it('toggles enabled flag and returns detail', async () => {
      const channel = makeChannel({ enabled: false });
      const updatedChannel = makeChannel({ enabled: true });

      // 1. findChannel (check exists)
      pushResponse([channel]);
      // 2. After update, getById → findChannel + relations
      setupGetByIdMocks(updatedChannel);

      const result = await ChannelService.setEnabled(CHANNEL_ID, true);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelService.setEnabled('00000000-0000-0000-0000-000000000099', true);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  // ========== DESTINATIONS SYNC ==========
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

      // 1. findChannel
      pushResponse([channel]);
      // 2. After db.update + delete + insert, findChannel + relations
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
      // Verify delete was called (for destination sync)
      expect(mockDelete).toHaveBeenCalled();
      // Verify insert was called (for new destinations)
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

  // ========== PRUNING FIELDS ==========
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

  // ========== CREATE WITH DESTINATIONS ==========
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

      pushResponse([]);  // uniqueness check
      // fetchChannelRelations after create
      pushResponse(DEFAULT_SCRIPTS);
      pushResponse(destRows, { orderable: true });
      pushResponse([]);
      pushResponse([]);
      pushResponse([]);  // filters
      pushResponse([]);  // filter rules
      pushResponse([]);  // transformers
      pushResponse([]);  // transformer steps

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

  // ========== FILTER/TRANSFORMER IN GETBYID ==========
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

  // ========== FILTER/TRANSFORMER SYNC ON UPDATE ==========
  describe('update — filter/transformer sync', () => {
    it('persists source filter rules on update', async () => {
      const channel = makeChannel();
      const updatedChannel = makeChannel({ revision: 2 });

      // findChannel
      pushResponse([channel]);
      // After update + sync, findChannel + fetchChannelRelations
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

      // Mock insert().values().returning() for filter insert
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'f1' }]),
        }),
      });

      const result = await ChannelService.update(CHANNEL_ID, {
        revision: 1,
        filters: [{
          connectorId: null,
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
          connectorId: null,
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
        filters: [{ connectorId: null, rules: [] }],
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
          connectorId: null,
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
