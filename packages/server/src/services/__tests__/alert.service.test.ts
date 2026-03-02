// ===========================================
// Alert Service Tests
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

// pushResponse is used for all select queries (where, orderBy, and direct from)

function consumeResponse(): unknown {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
}

const mockSelectWhere = vi.fn().mockImplementation(() => consumeResponse());

const mockSelectFrom = vi.fn().mockImplementation(() => {
  return {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void): Promise<unknown> {
      // Direct await on .from() — consume the response
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

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
  const txInsertValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const txSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
  const txUpdate = vi.fn().mockReturnValue({ set: txSet });
  const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });

  return fn({
    insert: txInsert,
    update: txUpdate,
    delete: txDelete,
    select: mockSelect,
  });
});

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
  count: vi.fn(() => 'count_agg'),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ type: 'inArray', vals })),
  sql: vi.fn(),
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { AlertService } = await import('../alert.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-03-01T12:00:00Z');
const ALERT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CHANNEL_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';
const ACTION_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33';

function makeAlertRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: ALERT_ID,
    name: 'Error Alert',
    description: 'Monitors errors',
    enabled: true,
    revision: 1,
    triggerType: 'CHANNEL_ERROR',
    triggerScript: JSON.stringify({ errorTypes: ['ANY'], regex: null }),
    subjectTemplate: null,
    bodyTemplate: null,
    reAlertIntervalMs: null,
    maxAlerts: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeChannelRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    alertId: ALERT_ID,
    channelId: CHANNEL_ID,
    ...overrides,
  };
}

function makeActionRow(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: ACTION_ID,
    alertId: ALERT_ID,
    actionType: 'EMAIL',
    recipients: ['admin@hospital.org'],
    properties: null,
    ...overrides,
  };
}

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('AlertService', () => {
  // ===== list =====

  describe('list', () => {
    it('returns paginated alerts with counts', async () => {
      const alert = makeAlertRow();
      // Total count
      pushResponse([{ value: 1 }]);
      // Alerts list (orderable with limit/offset)
      pushResponse([alert]);
      // Channel count for alert
      pushResponse([{ value: 2 }]);
      // Action count for alert
      pushResponse([{ value: 1 }]);

      const result = await AlertService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(1);
      expect(result.value.data[0]!.name).toBe('Error Alert');
      expect(result.value.data[0]!.channelCount).toBe(2);
      expect(result.value.data[0]!.actionCount).toBe(1);
      expect(result.value.pagination.total).toBe(1);
      expect(result.value.pagination.totalPages).toBe(1);
    });

    it('returns empty list', async () => {
      pushResponse([{ value: 0 }]);
      pushResponse([]);

      const result = await AlertService.list({ page: 1, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.data).toHaveLength(0);
      expect(result.value.pagination.total).toBe(0);
    });

    it('calculates pagination correctly', async () => {
      pushResponse([{ value: 30 }]);
      pushResponse([]);

      const result = await AlertService.list({ page: 2, pageSize: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pagination.page).toBe(2);
      expect(result.value.pagination.pageSize).toBe(10);
      expect(result.value.pagination.totalPages).toBe(3);
    });
  });

  // ===== getById =====

  describe('getById', () => {
    it('returns full alert detail', async () => {
      // Alert row
      pushResponse([makeAlertRow()]);
      // Channel rows
      pushResponse([makeChannelRow()]);
      // Action rows
      pushResponse([makeActionRow()]);

      const result = await AlertService.getById(ALERT_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(ALERT_ID);
      expect(result.value.trigger.type).toBe('CHANNEL_ERROR');
      expect(result.value.trigger.errorTypes).toEqual(['ANY']);
      expect(result.value.channelIds).toEqual([CHANNEL_ID]);
      expect(result.value.actions).toHaveLength(1);
      expect(result.value.actions[0]!.actionType).toBe('EMAIL');
    });

    it('returns NOT_FOUND when alert does not exist', async () => {
      pushResponse([]);

      const result = await AlertService.getById(ALERT_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('returns alert with no channels or actions', async () => {
      pushResponse([makeAlertRow()]);
      pushResponse([]);
      pushResponse([]);

      const result = await AlertService.getById(ALERT_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelIds).toEqual([]);
      expect(result.value.actions).toEqual([]);
      expect(result.value.channelCount).toBe(0);
      expect(result.value.actionCount).toBe(0);
    });
  });

  // ===== create =====

  describe('create', () => {
    it('creates alert with unique name', async () => {
      const created = makeAlertRow();
      // Check duplicate name
      pushResponse([]);
      // Transaction: insert returning
      mockReturning.mockResolvedValueOnce([created]);
      // fetchAlertDetail after create: alert row
      pushResponse([created]);
      // fetchAlertDetail: channels
      pushResponse([makeChannelRow()]);
      // fetchAlertDetail: actions
      pushResponse([makeActionRow()]);

      const result = await AlertService.create({
        name: 'Error Alert',
        description: 'Monitors errors',
        enabled: true,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
        channelIds: [CHANNEL_ID],
        actions: [{ type: 'EMAIL', recipients: ['admin@hospital.org'] }],
        subjectTemplate: null,
        bodyTemplate: null,
        reAlertIntervalMs: null,
        maxAlerts: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('Error Alert');
      expect(result.value.channelIds).toEqual([CHANNEL_ID]);
    });

    it('returns ALREADY_EXISTS when name is taken', async () => {
      pushResponse([{ id: ALERT_ID }]);

      const result = await AlertService.create({
        name: 'Error Alert',
        description: '',
        enabled: true,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
        channelIds: [],
        actions: [],
        subjectTemplate: null,
        bodyTemplate: null,
        reAlertIntervalMs: null,
        maxAlerts: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });

    it('creates alert with no channels or actions', async () => {
      const created = makeAlertRow();
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);
      pushResponse([created]);
      pushResponse([]);
      pushResponse([]);

      const result = await AlertService.create({
        name: 'Error Alert',
        description: '',
        enabled: true,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
        channelIds: [],
        actions: [],
        subjectTemplate: null,
        bodyTemplate: null,
        reAlertIntervalMs: null,
        maxAlerts: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channelIds).toEqual([]);
      expect(result.value.actions).toEqual([]);
    });

    it('creates alert with CHANNEL action', async () => {
      const created = makeAlertRow();
      const channelAction = makeActionRow({
        actionType: 'CHANNEL',
        recipients: [],
        properties: { channelId: CHANNEL_ID },
      });
      pushResponse([]);
      mockReturning.mockResolvedValueOnce([created]);
      pushResponse([created]);
      pushResponse([]);
      pushResponse([channelAction]);

      const result = await AlertService.create({
        name: 'Error Alert',
        description: '',
        enabled: true,
        trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
        channelIds: [],
        actions: [{ type: 'CHANNEL', channelId: CHANNEL_ID, recipients: [] }],
        subjectTemplate: null,
        bodyTemplate: null,
        reAlertIntervalMs: null,
        maxAlerts: null,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.actions[0]!.actionType).toBe('CHANNEL');
    });
  });

  // ===== update =====

  describe('update', () => {
    it('updates alert with correct revision', async () => {
      const existing = makeAlertRow();
      const updated = makeAlertRow({ name: 'Updated Alert', revision: 2 });
      // Find existing
      pushResponse([existing]);
      // Check duplicate name (name changed)
      pushResponse([]);
      // fetchAlertDetail after update: alert row
      pushResponse([updated]);
      // fetchAlertDetail: channels
      pushResponse([]);
      // fetchAlertDetail: actions
      pushResponse([]);

      const result = await AlertService.update(ALERT_ID, {
        name: 'Updated Alert',
        revision: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe('Updated Alert');
      expect(result.value.revision).toBe(2);
    });

    it('returns NOT_FOUND when alert does not exist', async () => {
      pushResponse([]);

      const result = await AlertService.update(ALERT_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('returns CONFLICT when revision mismatch', async () => {
      pushResponse([makeAlertRow({ revision: 2 })]);

      const result = await AlertService.update(ALERT_ID, {
        name: 'test',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('modified'));
    });

    it('returns ALREADY_EXISTS when duplicate name on rename', async () => {
      const existing = makeAlertRow();
      // Find existing
      pushResponse([existing]);
      // Check duplicate name
      pushResponse([{ id: 'other-id' }]);

      const result = await AlertService.update(ALERT_ID, {
        name: 'Duplicate Name',
        revision: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('already exists'));
    });

    it('syncs channels on update', async () => {
      const existing = makeAlertRow();
      const updated = makeAlertRow({ revision: 2 });
      pushResponse([existing]);
      pushResponse([updated]);
      pushResponse([makeChannelRow()]);
      pushResponse([]);

      const result = await AlertService.update(ALERT_ID, {
        channelIds: [CHANNEL_ID],
        revision: 1,
      });

      expect(result.ok).toBe(true);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('syncs actions on update', async () => {
      const existing = makeAlertRow();
      const updated = makeAlertRow({ revision: 2 });
      pushResponse([existing]);
      pushResponse([updated]);
      pushResponse([]);
      pushResponse([makeActionRow()]);

      const result = await AlertService.update(ALERT_ID, {
        actions: [{ type: 'EMAIL', recipients: ['new@hospital.org'] }],
        revision: 1,
      });

      expect(result.ok).toBe(true);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  // ===== delete =====

  describe('delete', () => {
    it('deletes existing alert', async () => {
      pushResponse([{ id: ALERT_ID }]);

      const result = await AlertService.delete(ALERT_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND when alert does not exist', async () => {
      pushResponse([]);

      const result = await AlertService.delete(ALERT_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  // ===== setEnabled =====

  describe('setEnabled', () => {
    it('enables alert', async () => {
      const updated = makeAlertRow({ enabled: true });
      // Check exists
      pushResponse([{ id: ALERT_ID }]);
      // fetchAlertDetail: alert row
      pushResponse([updated]);
      // fetchAlertDetail: channels
      pushResponse([]);
      // fetchAlertDetail: actions
      pushResponse([]);

      const result = await AlertService.setEnabled(ALERT_ID, true);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
    });

    it('disables alert', async () => {
      const updated = makeAlertRow({ enabled: false });
      pushResponse([{ id: ALERT_ID }]);
      pushResponse([updated]);
      pushResponse([]);
      pushResponse([]);

      const result = await AlertService.setEnabled(ALERT_ID, false);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(false);
    });

    it('returns NOT_FOUND when alert does not exist', async () => {
      pushResponse([]);

      const result = await AlertService.setEnabled(ALERT_ID, true);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  // ===== getByIds =====

  describe('getByIds', () => {
    it('returns empty array for empty input', async () => {
      const result = await AlertService.getByIds([]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('returns full detail for multiple alerts in one batch', async () => {
      const ALERT_ID_2 = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380d44';
      // Alerts rows
      pushResponse([makeAlertRow(), makeAlertRow({ id: ALERT_ID_2, name: 'Second Alert' })]);
      // Channel rows (batch)
      pushResponse([makeChannelRow()]);
      // Action rows (batch)
      pushResponse([makeActionRow(), makeActionRow({ id: 'action-2', alertId: ALERT_ID_2 })]);

      const result = await AlertService.getByIds([ALERT_ID, ALERT_ID_2]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.id).toBe(ALERT_ID);
      expect(result.value[0]!.channelIds).toEqual([CHANNEL_ID]);
      expect(result.value[0]!.actions).toHaveLength(1);
      expect(result.value[1]!.id).toBe(ALERT_ID_2);
      expect(result.value[1]!.name).toBe('Second Alert');
    });

    it('returns empty array when no alerts found for given IDs', async () => {
      pushResponse([]);

      const result = await AlertService.getByIds(['nonexistent-id']);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('groups channels and actions by alertId correctly', async () => {
      const ALERT_ID_2 = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380d44';
      const CHANNEL_ID_2 = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e55';
      // Alert rows
      pushResponse([makeAlertRow(), makeAlertRow({ id: ALERT_ID_2, name: 'Second Alert' })]);
      // Channel rows — first alert has 2 channels, second has 0
      pushResponse([
        makeChannelRow(),
        makeChannelRow({ channelId: CHANNEL_ID_2 }),
      ]);
      // Action rows — first alert has 0 actions, second has 1
      pushResponse([
        makeActionRow({ alertId: ALERT_ID_2, id: 'action-2' }),
      ]);

      const result = await AlertService.getByIds([ALERT_ID, ALERT_ID_2]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.channelIds).toEqual([CHANNEL_ID, CHANNEL_ID_2]);
      expect(result.value[0]!.actions).toEqual([]);
      expect(result.value[1]!.channelIds).toEqual([]);
      expect(result.value[1]!.actions).toHaveLength(1);
    });
  });
});
