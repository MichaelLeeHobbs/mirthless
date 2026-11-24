// We mock getById and create at the service boundary since clone delegates to them.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', text: strings.join('?'), values })),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// Placing a new channel in a group is covered against Postgres (create-in-scope.itest.ts).
vi.mock('../grant.service.js', () => ({ GrantService: { placeNewChannel: vi.fn().mockResolvedValue(null), newChannelGroup: vi.fn().mockResolvedValue(null) } }));

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

const { ChannelService } = await import('../channel.service.js');
const { emitEvent } = await import('../../lib/event-emitter.js');
const { channels, channelConnectors, channelFilters, filterRules, channelTransformers, transformerSteps, codeTemplateLibraries } =
  await import('../../db/schema/index.js');

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

const RULE = {
  enabled: false, name: 'ADT only', operator: 'OR', type: 'RULE_BUILDER', script: 'return msg.MSH[9] === "ADT";', language: 'TYPESCRIPT',
  field: 'MSH.9', condition: 'EQUALS', values: ['ADT', 'ORU'],
};

const TRANSFORMER = {
  inboundDataType: 'JSON', outboundDataType: 'XML', inboundProperties: { in: 1 }, outboundProperties: { out: 2 },
  inboundTemplate: 'in template', outboundTemplate: 'out template',
};

const STEP = {
  enabled: false, name: 'Set MRN', type: 'MAPPER', script: 'tmp.mrn = msg.PID[3];', language: 'TYPESCRIPT',
  sourceField: 'PID.3', targetField: 'mrn', defaultValue: 'none', mapping: 'COPY',
};

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
    scriptTimeoutSeconds: 30,
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

function setupGetByIdMocks(
  channel: Record<string, unknown>,
  relations?: {
    scripts?: unknown[];
    destinations?: unknown[];
    metadataColumns?: unknown[];
    filters?: unknown[];
    filterRules?: unknown[];
    transformers?: unknown[];
    transformerSteps?: unknown[];
  },
): void {
  pushResponse([channel]);                                                    // findChannel
  pushResponse(relations?.scripts ?? DEFAULT_SCRIPTS);                        // scripts
  pushResponse(relations?.destinations ?? [], { orderable: true });           // destinations
  pushResponse(relations?.metadataColumns ?? []);                             // metadataColumns
  pushResponse([]);                                                           // tags
  pushResponse(relations?.filters ?? []);                                     // filters
  pushResponse(relations?.filterRules ?? []);                                 // filter rules
  pushResponse(relations?.transformers ?? []);                                // transformers
  pushResponse(relations?.transformerSteps ?? []);                            // transformer steps
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
      insert: vi.fn().mockImplementation((table: unknown) => {
        insertCallCount++;
        // Channel insert (call 1) returns the created row; later inserts return
        // []. Every .values() supports both `.returning()` and direct await.
        const rows = insertCallCount === 1 ? [channel] : [];
        return {
          values: (values: unknown) => {
            txInserts.push({ table, values });
            return Object.assign(Promise.resolve(rows), {
              returning: vi.fn().mockResolvedValue(rows),
            });
          },
        };
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: txUpdate,
    };
    return fn(tx);
  });
}

let txInserts: { table: unknown; values: unknown }[] = [];
const insertedChannels = (): readonly unknown[] => txInserts.filter((i) => i.table === channels).map((i) => i.values);

interface RecordedUpdate { table: unknown; values: Record<string, unknown>; condition: unknown }
let txUpdates: RecordedUpdate[] = [];
const txUpdate = vi.fn((table: unknown) => ({
  set: (values: Record<string, unknown>) => ({
    where: (condition: unknown) => {
      txUpdates.push({ table, values, condition });
      return Promise.resolve(undefined);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
  txInserts = [];
  txUpdates = [];
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
    expect(insertedChannels()).toEqual([expect.objectContaining({ name: 'Cloned Channel' })]);
  });

  it('sets enabled to false on the cloned channel', async () => {
    const source = makeChannel({ enabled: true });
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(insertedChannels()).toEqual([expect.objectContaining({ enabled: false })]);
  });

  it('copies channel properties from source', async () => {
    const source = makeChannel({ responseConnectorName: 'Dest 1' });
    const cloned = makeClonedChannel();

    setupGetByIdMocks(source);
    setupCreateMocks(cloned);

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
    expect(createInput.responseConnectorName).toBe('Dest 1');
    expect(createInput.properties).toEqual({
      initialState: 'STARTED',
      messageStorageMode: 'PRODUCTION',
      // An encrypted channel's clone stays encrypted (no silent plaintext PHI).
      encryptData: true,
      removeContentOnCompletion: true,
      removeAttachmentsOnCompletion: false,
      pruningEnabled: true,
      pruningMaxAgeDays: 30,
      pruningArchiveEnabled: true,
      scriptTimeoutSeconds: 30,
    });

    createSpy.mockRestore();
  });

  it('copies scripts from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    const languages = ['TYPESCRIPT', 'JAVASCRIPT', 'JAVASCRIPT', 'TYPESCRIPT'];
    setupGetByIdMocks(source, { scripts: DEFAULT_SCRIPTS.map((script, i) => ({ ...script, language: languages[i] })) });
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.scripts).toEqual({
      deploy: 'deploy code', undeploy: 'undeploy code', preprocessor: '', postprocessor: '',
      languages: { deploy: 'TYPESCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'TYPESCRIPT' },
    });

    createSpy.mockRestore();
  });

  it('copies destinations from source', async () => {
    const source = makeChannel();
    const cloned = makeClonedChannel();

    const copied = DESTINATIONS.map(({ id: _id, metaDataId: _metaDataId, ...rest }, i) => ({
      ...rest, responseTransformer: i === 0 ? null : 'responseStatus = SENT;', responseTransformerLanguage: i === 0 ? 'JAVASCRIPT' : 'TYPESCRIPT',
    }));
    setupGetByIdMocks(source, { destinations: copied.map((dest, i) => ({ id: `d${String(i)}`, metaDataId: i + 1, ...dest })) });
    setupCreateMocks(cloned);

    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();

    const createInput = createSpy.mock.calls[0]![0];
    expect(createInput.destinations).toEqual(copied);

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
    pushResponse([]);

    const result = await ChannelService.clone('00000000-0000-0000-0000-000000000099', 'Clone');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'NOT_FOUND');
  });

  it('refuses to clone a channel whose source points the wrong way (#109)', async () => {
    setupGetByIdMocks(makeChannel({ sourceConnectorType: 'SMTP' }));
    const createSpy = vi.spyOn(ChannelService, 'create');

    const result = await ChannelService.clone(CHANNEL_ID, 'Copy');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'INVALID_INPUT');
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('returns ALREADY_EXISTS when clone name conflicts', async () => {
    const source = makeChannel();
    makeClonedChannel();

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

  it('copies the source filter, a destination transformer and a response transformer onto the clone', async () => {
    // The source's destinations have metaDataIds 1 and 3 (2 was deleted). The
    // clone renumbers them 1 and 2, so the transformer on the second
    // destination must land on the clone's second destination row.
    const destinations = [
      { ...DESTINATIONS[0]!, id: 'd1', metaDataId: 1, responseTransformer: null },
      { ...DESTINATIONS[1]!, id: 'd3', metaDataId: 3, responseTransformer: 'responseStatus = SENT;' },
    ];
    setupGetByIdMocks(makeChannel(), {
      destinations,
      filters: [{ id: 'f1', connectorId: null }],
      filterRules: [{
        id: 'r1', filterId: 'f1', sequenceNumber: 0, ...RULE,
      }],
      transformers: [{
        id: 't1', connectorId: 'd3', ...TRANSFORMER,
      }],
      transformerSteps: [{
        id: 'st1', transformerId: 't1', sequenceNumber: 0, ...STEP,
      }],
    });
    setupCreateMocks(makeClonedChannel());

    const inserted = new Map<unknown, unknown[]>();
    const returnedRows = new Map<unknown, unknown[]>([
      [channels, [makeClonedChannel()]],
      [channelConnectors, [{ id: 'new-d1', metaDataId: 1 }, { id: 'new-d2', metaDataId: 2 }]],
      [channelFilters, [{ id: 'new-f1' }]],
      [channelTransformers, [{ id: 'new-t1' }]],
    ]);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          inserted.set(table, [...(inserted.get(table) ?? []), values]);
          const rows = returnedRows.get(table) ?? [];
          return Object.assign(Promise.resolve(rows), { returning: vi.fn().mockResolvedValue(rows) });
        },
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: txUpdate,
    }));

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');
    expect(result.ok).toBe(true);

    expect(inserted.get(channelFilters)).toEqual([{ channelId: CLONED_ID, connectorId: null }]);
    // Every field travels, the language too: a TypeScript rule must stay type-checked on the clone.
    expect(inserted.get(filterRules)).toEqual([[{ filterId: 'new-f1', sequenceNumber: 0, ...RULE }]]);
    // Destination transformer: on the clone's second destination, not the source's d3.
    expect(inserted.get(channelTransformers)).toEqual([{ channelId: CLONED_ID, connectorId: 'new-d2', ...TRANSFORMER }]);
    expect(inserted.get(transformerSteps)).toEqual([[{ transformerId: 'new-t1', sequenceNumber: 0, ...STEP }]]);
    const destValues = inserted.get(channelConnectors)?.[0] as readonly Record<string, unknown>[];
    expect(destValues[1]).toEqual(expect.objectContaining({ metaDataId: 2, responseTransformer: 'responseStatus = SENT;' }));
  });

  it('fails without creating a clone when a filter names a connector the channel does not have', async () => {
    setupGetByIdMocks(makeChannel(), {
      destinations: DESTINATIONS,
      filters: [{ id: 'f1', connectorId: 'missing-connector' }],
    });

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'INTERNAL');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('adds the clone to the code template libraries that list the original, inside the create transaction', async () => {
    setupGetByIdMocks(makeChannel());
    setupCreateMocks(makeClonedChannel());

    const result = await ChannelService.clone(CHANNEL_ID, 'Cloned Channel');

    expect(result.ok).toBe(true);
    const libraryUpdates = txUpdates.filter((u) => u.table === codeTemplateLibraries);
    expect(libraryUpdates).toHaveLength(1);
    // Only libraries whose list contains the original (a null list matches nothing in SQL).
    expect(libraryUpdates[0]!.condition).toEqual(expect.objectContaining({ values: [expect.anything(), JSON.stringify([CHANNEL_ID])] }));
    expect(libraryUpdates[0]!.values['channelIds']).toEqual(expect.objectContaining({ values: [expect.anything(), JSON.stringify([CLONED_ID])] }));
  });

  it('does not touch code template libraries when creating a channel that is not a clone', async () => {
    setupCreateMocks(makeClonedChannel());

    const result = await ChannelService.create({
      name: 'Fresh', description: '', enabled: false, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP', sourceConnectorProperties: {}, responseMode: 'AUTO_AFTER_DESTINATIONS',
    } as Parameters<typeof ChannelService.create>[0]);

    expect(result.ok).toBe(true);
    expect(txUpdates.filter((u) => u.table === codeTemplateLibraries)).toEqual([]);
  });
});
