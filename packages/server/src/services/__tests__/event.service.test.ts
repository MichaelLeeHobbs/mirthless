// ===========================================
// Event Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock DB -----

let selectCallIndex = 0;
let selectResponses: (() => unknown)[] = [];

function resetSelectState(): void {
  selectCallIndex = 0;
  selectResponses = [];
}

function pushResponse(value: unknown): void {
  selectResponses.push(() => value);
}

function consumeResponse(): unknown {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const value = consumeResponse();
  return Object.assign(Promise.resolve(value), {
    orderBy: vi.fn().mockImplementation(() => {
      return Object.assign(Promise.resolve(value), {
        limit: vi.fn().mockReturnValue(
          Object.assign(Promise.resolve(value), {
            offset: vi.fn().mockResolvedValue(value),
          }),
        ),
      });
    }),
  });
});

const mockSelectFrom = vi.fn().mockImplementation(() => {
  return {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void): Promise<unknown> {
      const value = consumeResponse();
      return Promise.resolve(value).then(resolve, reject);
    },
    where: mockSelectWhere,
    orderBy: vi.fn().mockImplementation(() => {
      const value = consumeResponse();
      return Object.assign(Promise.resolve(value), {
        limit: vi.fn().mockReturnValue(
          Object.assign(Promise.resolve(value), {
            offset: vi.fn().mockResolvedValue(value),
          }),
        ),
      });
    }),
  };
});

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteReturning = vi.fn();
const mockDeleteWhere = vi.fn().mockReturnValue({ returning: mockDeleteReturning });
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  delete: mockDelete,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  count: vi.fn(() => 'count_agg'),
  desc: vi.fn((_col: unknown) => ({ type: 'desc' })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ type: 'inArray', vals })),
  gte: vi.fn((_col: unknown, val: unknown) => ({ type: 'gte', val })),
  lte: vi.fn((_col: unknown, val: unknown) => ({ type: 'lte', val })),
  sql: vi.fn(),
}));

const { EventService } = await import('../event.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-01T12:00:00Z');
const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CHANNEL_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';

function makeEventRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 1,
    level: 'INFO',
    name: 'USER_LOGIN',
    outcome: 'SUCCESS',
    userId: USER_ID,
    channelId: null,
    ipAddress: '192.168.1.100',
    serverId: 'server-01',
    attributes: { browser: 'Chrome' },
    createdAt: NOW,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('EventService', () => {
  // ===== list =====

  describe('list', () => {
    it('returns paginated events', async () => {
      const event = makeEventRow();
      // Total count (no where)
      pushResponse([{ value: 1 }]);
      // Events list (orderBy chain)
      pushResponse([event]);

      const result = await EventService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(1);
      expect(result.value.data[0]!.level).toBe('INFO');
      expect(result.value.data[0]!.name).toBe('USER_LOGIN');
      expect(result.value.pagination.total).toBe(1);
      expect(result.value.pagination.totalPages).toBe(1);
    });

    it('returns empty list', async () => {
      pushResponse([{ value: 0 }]);
      pushResponse([]);

      const result = await EventService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(0);
      expect(result.value.pagination.total).toBe(0);
    });

    it('calculates pagination correctly', async () => {
      pushResponse([{ value: 75 }]);
      pushResponse([]);

      const result = await EventService.list({ page: 3, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pagination.page).toBe(3);
      expect(result.value.pagination.pageSize).toBe(25);
      expect(result.value.pagination.totalPages).toBe(3);
    });

    it('applies level filter', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow({ level: 'ERROR' })]);

      const result = await EventService.list({ page: 1, pageSize: 25, level: 'ERROR' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(1);
    });

    it('applies name filter with comma separation', async () => {
      pushResponse([{ value: 2 }]);
      pushResponse([
        makeEventRow({ id: 1, name: 'USER_LOGIN' }),
        makeEventRow({ id: 2, name: 'USER_CREATED' }),
      ]);

      const result = await EventService.list({
        page: 1,
        pageSize: 25,
        name: 'USER_LOGIN,USER_CREATED',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(2);
    });

    it('applies outcome filter', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow({ outcome: 'FAILURE' })]);

      const result = await EventService.list({ page: 1, pageSize: 25, outcome: 'FAILURE' });

      expect(result.ok).toBe(true);
    });

    it('applies userId filter', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow()]);

      const result = await EventService.list({ page: 1, pageSize: 25, userId: USER_ID });

      expect(result.ok).toBe(true);
    });

    it('applies channelId filter', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow({ channelId: CHANNEL_ID })]);

      const result = await EventService.list({ page: 1, pageSize: 25, channelId: CHANNEL_ID });

      expect(result.ok).toBe(true);
    });

    it('applies date range filters', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow()]);

      const result = await EventService.list({
        page: 1,
        pageSize: 25,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });

      expect(result.ok).toBe(true);
    });

    it('combines multiple filters', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow({ level: 'ERROR', outcome: 'FAILURE' })]);

      const result = await EventService.list({
        page: 1,
        pageSize: 25,
        level: 'ERROR',
        outcome: 'FAILURE',
        userId: USER_ID,
      });

      expect(result.ok).toBe(true);
    });

    it('maps null userId/channelId/ipAddress to null', async () => {
      pushResponse([{ value: 1 }]);
      pushResponse([makeEventRow({ userId: undefined, channelId: undefined, ipAddress: undefined })]);

      const result = await EventService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data[0]!.userId).toBeNull();
      expect(result.value.data[0]!.channelId).toBeNull();
      expect(result.value.data[0]!.ipAddress).toBeNull();
    });
  });

  // ===== getById =====

  describe('getById', () => {
    it('returns full event detail', async () => {
      pushResponse([makeEventRow()]);

      const result = await EventService.getById(1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(1);
      expect(result.value.level).toBe('INFO');
      expect(result.value.name).toBe('USER_LOGIN');
      expect(result.value.serverId).toBe('server-01');
      expect(result.value.attributes).toEqual({ browser: 'Chrome' });
    });

    it('returns NOT_FOUND for missing event', async () => {
      pushResponse([]);

      const result = await EventService.getById(999);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('maps null optional fields', async () => {
      pushResponse([makeEventRow({
        userId: undefined,
        channelId: undefined,
        ipAddress: undefined,
        serverId: undefined,
        attributes: undefined,
      })]);

      const result = await EventService.getById(1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.userId).toBeNull();
      expect(result.value.channelId).toBeNull();
      expect(result.value.ipAddress).toBeNull();
      expect(result.value.serverId).toBeNull();
      expect(result.value.attributes).toBeNull();
    });
  });

  // ===== create =====

  describe('create', () => {
    it('creates event with all fields', async () => {
      const row = makeEventRow();
      mockReturning.mockResolvedValueOnce([row]);

      const result = await EventService.create({
        level: 'INFO',
        name: 'USER_LOGIN',
        outcome: 'SUCCESS',
        userId: USER_ID,
        channelId: null,
        serverId: 'server-01',
        ipAddress: '192.168.1.100',
        attributes: { browser: 'Chrome' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.level).toBe('INFO');
      expect(result.value.name).toBe('USER_LOGIN');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('creates event with null defaults', async () => {
      const row = makeEventRow({
        userId: null,
        channelId: null,
        serverId: null,
        ipAddress: null,
        attributes: null,
      });
      mockReturning.mockResolvedValueOnce([row]);

      const result = await EventService.create({
        level: 'WARN',
        name: 'SETTINGS_CHANGED',
        outcome: 'SUCCESS',
        userId: null,
        channelId: null,
        serverId: null,
        ipAddress: null,
        attributes: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.userId).toBeNull();
      expect(result.value.attributes).toBeNull();
    });
  });

  // ===== purge =====

  describe('purge', () => {
    it('deletes old events and returns count', async () => {
      mockDeleteReturning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await EventService.purge(90);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deleted).toBe(3);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns zero when no events match', async () => {
      mockDeleteReturning.mockResolvedValueOnce([]);

      const result = await EventService.purge(1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deleted).toBe(0);
    });
  });
});
