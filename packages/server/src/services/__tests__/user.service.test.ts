// ===========================================
// User Service Tests
// ===========================================

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

const mockSelectFrom = vi.fn().mockImplementation(() => ({
  where: mockSelectWhere,
  orderBy: vi.fn().mockImplementation(() => {
    const fn = selectResponses[selectCallIndex];
    selectCallIndex++;
    if (fn) return fn();
    return [];
  }),
}));

const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
};

vi.mock('../../lib/db.js', () => ({
  db: mockDb,
  default: mockDb,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$12$hashed'),
  },
}));

vi.mock('../../lib/event-emitter.js', () => ({
  emitEvent: vi.fn(),
}));

// Must import after mocks
const { UserService } = await import('../user.service.js');

// ----- Fixtures -----

const NOW = new Date('2026-02-28T12:00:00Z');
const ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const OTHER_ID = '00000000-0000-0000-0000-000000000003';

function makeUser(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: USER_ID,
    username: 'jsmith',
    email: 'jsmith@test.com',
    firstName: 'John',
    lastName: 'Smith',
    description: null,
    role: 'developer',
    enabled: true,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetSelectState();
});

// ----- Tests -----

describe('UserService', () => {
  describe('listUsers', () => {
    it('returns all users ordered by username', async () => {
      const userList = [makeUser(), makeUser({ id: ADMIN_ID, username: 'admin', role: 'admin' })];
      pushResponse(userList, { orderable: true });

      const result = await UserService.listUsers();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it('returns empty array when no users', async () => {
      pushResponse([], { orderable: true });

      const result = await UserService.listUsers();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe('getUser', () => {
    it('returns user detail', async () => {
      pushResponse([makeUser()]);

      const result = await UserService.getUser(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.username).toBe('jsmith');
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.getUser('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('createUser', () => {
    it('creates user with hashed password', async () => {
      // Username check
      pushResponse([]);
      // Email check
      pushResponse([]);
      // Insert returning
      const newUser = makeUser({ username: 'newuser', email: 'new@test.com' });
      mockInsertReturning.mockResolvedValueOnce([newUser]);

      const result = await UserService.createUser({
        username: 'newuser',
        email: 'new@test.com',
        password: 'password123',
        role: 'developer',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.username).toBe('newuser');
    });

    it('returns ALREADY_EXISTS for duplicate username', async () => {
      pushResponse([{ id: USER_ID }]); // Username exists

      const result = await UserService.createUser({
        username: 'jsmith',
        email: 'new@test.com',
        password: 'password123',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    });

    it('returns ALREADY_EXISTS for duplicate email', async () => {
      pushResponse([]); // Username check passes
      pushResponse([{ id: USER_ID }]); // Email exists

      const result = await UserService.createUser({
        username: 'newuser',
        email: 'jsmith@test.com',
        password: 'password123',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'ALREADY_EXISTS');
    });
  });

  describe('updateUser', () => {
    it('updates user fields', async () => {
      // Existing user check
      pushResponse([{ id: USER_ID, role: 'developer' }]);
      // getUser for return (after update)
      pushResponse([makeUser({ email: 'updated@test.com' })]);

      const result = await UserService.updateUser(USER_ID, { email: 'updated@test.com' }, ADMIN_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.email).toBe('updated@test.com');
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.updateUser('nonexistent', { email: 'x@y.com' }, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });

    it('returns SELF_ACTION when changing own role', async () => {
      pushResponse([{ id: ADMIN_ID, role: 'admin' }]);

      const result = await UserService.updateUser(ADMIN_ID, { role: 'developer' }, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'SELF_ACTION');
    });
  });

  describe('deleteUser', () => {
    it('soft-deletes user', async () => {
      pushResponse([{ id: USER_ID, role: 'developer' }]);

      const result = await UserService.deleteUser(USER_ID, ADMIN_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns SELF_ACTION when deleting self', async () => {
      const result = await UserService.deleteUser(ADMIN_ID, ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'SELF_ACTION');
    });

    it('returns CONFLICT when deleting last admin', async () => {
      pushResponse([{ id: ADMIN_ID, role: 'admin' }]); // User lookup
      pushResponse([{ id: ADMIN_ID }]); // Admin count (only 1)

      const result = await UserService.deleteUser(ADMIN_ID, OTHER_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.deleteUser('nonexistent', ADMIN_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('changePassword', () => {
    it('admin changes other user password', async () => {
      pushResponse([{ id: USER_ID }]);

      const result = await UserService.changePassword(USER_ID, 'newpass123', ADMIN_ID, 'admin');

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('user changes own password', async () => {
      pushResponse([{ id: USER_ID }]);

      const result = await UserService.changePassword(USER_ID, 'newpass123', USER_ID, 'developer');

      expect(result.ok).toBe(true);
    });

    it('non-admin cannot change other user password', async () => {
      const result = await UserService.changePassword(OTHER_ID, 'newpass123', USER_ID, 'developer');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'FORBIDDEN');
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.changePassword('nonexistent', 'newpass123', ADMIN_ID, 'admin');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('unlockUser', () => {
    it('resets lockout state', async () => {
      pushResponse([{ id: USER_ID }]);

      const result = await UserService.unlockUser(USER_ID);

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for missing user', async () => {
      pushResponse([]);

      const result = await UserService.unlockUser('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
