// ===========================================
// Channel Dependency Service Tests
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

function pushJoinableResponse(value: unknown): void {
  selectResponses.push(() => ({
    _joinable: true,
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(value),
    }),
  }));
}

const mockSelectWhere = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];
  selectCallIndex++;
  if (fn) return fn();
  return [];
});

const mockSelectFrom = vi.fn().mockImplementation(() => {
  const fn = selectResponses[selectCallIndex];

  // Check if this is a joinable response (needs innerJoin)
  if (fn) {
    const peeked = fn();
    if (peeked && typeof peeked === 'object' && '_joinable' in peeked) {
      selectCallIndex++;
      return peeked;
    }
  }

  // Return a thenable that also has .where() and .innerJoin()
  // When awaited directly (no .where()), consumes the current response.
  // When .where() is called, mockSelectWhere consumes the response instead.
  const fromResult = {
    then: (
      resolve: (val: unknown) => unknown,
      reject?: (err: unknown) => unknown,
    ) => {
      const responseFn = selectResponses[selectCallIndex];
      selectCallIndex++;
      const value = responseFn ? responseFn() : [];
      return Promise.resolve(value).then(resolve, reject);
    },
    where: mockSelectWhere,
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const joinFn = selectResponses[selectCallIndex];
        selectCallIndex++;
        if (joinFn) return joinFn();
        return [];
      }),
    }),
  };

  return fromResult;
});

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
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
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

const { ChannelDependencyService } = await import('../channel-dependency.service.js');

// ----- Fixtures -----

const CHANNEL_A = '00000000-0000-0000-0000-00000000000a';
const CHANNEL_B = '00000000-0000-0000-0000-00000000000b';
const CHANNEL_C = '00000000-0000-0000-0000-00000000000c';

// ----- Tests -----

beforeEach(() => {
  resetSelectState();
  vi.clearAllMocks();
});

describe('ChannelDependencyService', () => {
  describe('getDependencies', () => {
    it('returns dependency list', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushJoinableResponse([{ channelId: CHANNEL_B, channelName: 'Channel B' }]);

      const result = await ChannelDependencyService.getDependencies(CHANNEL_A);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.channelName).toBe('Channel B');
    });

    it('returns empty array for no dependencies', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushJoinableResponse([]);

      const result = await ChannelDependencyService.getDependencies(CHANNEL_A);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelDependencyService.getDependencies(CHANNEL_A);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });
  });

  describe('setDependencies', () => {
    it('replaces all dependencies', async () => {
      // Channel exists
      pushResponse([{ id: CHANNEL_A }]);
      // Dep channel B exists
      pushResponse([{ id: CHANNEL_B }]);
      // All existing deps for DAG validation (direct from() await)
      pushResponse([]);
      // Return new deps after insert
      pushJoinableResponse([{ channelId: CHANNEL_B, channelName: 'Channel B' }]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
    });

    it('with empty array clears dependencies', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      // Return deps after delete
      pushJoinableResponse([]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing channel', async () => {
      pushResponse([]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('not found'));
    });

    it('returns NOT_FOUND for missing dependency channel', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushResponse([]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Dependency channel'));
    });

    it('rejects self-dependency', async () => {
      pushResponse([{ id: CHANNEL_A }]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_A],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('itself'));
    });

    it('rejects circular dependency (A->B->A)', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushResponse([{ id: CHANNEL_B }]);
      // Existing deps: B depends on A (direct from() await)
      pushResponse([{ from: CHANNEL_B, to: CHANNEL_A }]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Circular dependency'));
    });

    it('rejects transitive circular dependency (A->B->C->A)', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushResponse([{ id: CHANNEL_B }]);
      // Existing deps: B->C, C->A (direct from() await)
      pushResponse([
        { from: CHANNEL_B, to: CHANNEL_C },
        { from: CHANNEL_C, to: CHANNEL_A },
      ]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Circular dependency'));
    });

    it('allows valid DAG (A->B, A->C, B->C)', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushResponse([{ id: CHANNEL_B }]);
      pushResponse([{ id: CHANNEL_C }]);
      // Existing deps: B->C (direct from() await)
      pushResponse([{ from: CHANNEL_B, to: CHANNEL_C }]);
      // Return new deps
      pushJoinableResponse([
        { channelId: CHANNEL_B, channelName: 'Channel B' },
        { channelId: CHANNEL_C, channelName: 'Channel C' },
      ]);

      const result = await ChannelDependencyService.setDependencies(CHANNEL_A, {
        dependsOnChannelIds: [CHANNEL_B, CHANNEL_C],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });
  });

  describe('getDependents', () => {
    it('returns channels depending on this one', async () => {
      pushResponse([{ id: CHANNEL_B }]);
      pushJoinableResponse([{ channelId: CHANNEL_A, channelName: 'Channel A' }]);

      const result = await ChannelDependencyService.getDependents(CHANNEL_B);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.channelName).toBe('Channel A');
    });

    it('returns empty array for no dependents', async () => {
      pushResponse([{ id: CHANNEL_A }]);
      pushJoinableResponse([]);

      const result = await ChannelDependencyService.getDependents(CHANNEL_A);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('validateDAG', () => {
    it('detects direct cycle', async () => {
      // Existing deps: B->A (direct from() await in validateDAG)
      pushResponse([{ from: CHANNEL_B, to: CHANNEL_A }]);

      const result = await ChannelDependencyService.validateDAG(CHANNEL_A, [CHANNEL_B]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Circular dependency'));
    });

    it('detects multi-hop cycle', async () => {
      // Existing deps: B->C, C->A (direct from() await in validateDAG)
      pushResponse([
        { from: CHANNEL_B, to: CHANNEL_C },
        { from: CHANNEL_C, to: CHANNEL_A },
      ]);

      const result = await ChannelDependencyService.validateDAG(CHANNEL_A, [CHANNEL_B]);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('message', expect.stringContaining('Circular dependency'));
    });
  });
});
