// ===========================================
// User Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

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

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

// A transaction just runs its callback against the same mockDb.
const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));

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
  ne: vi.fn((_col: unknown, val: unknown) => ({ type: 'ne', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  asc: vi.fn((_col: unknown) => ({ type: 'asc' })),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$12$hashed'),
    compare: vi.fn().mockResolvedValue(true),
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

    it('returns CONFLICT when deleting the last enabled admin', async () => {
      pushResponse([{ id: ADMIN_ID, role: 'admin' }]); // User lookup
      pushResponse([]); // No OTHER enabled admins

      const result = await UserService.deleteUser(ADMIN_ID, OTHER_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'CONFLICT');
    });

    it('allows deleting an admin when another enabled admin exists', async () => {
      pushResponse([{ id: ADMIN_ID, role: 'admin' }]); // User lookup
      pushResponse([{ id: OTHER_ID }]); // Another enabled admin exists

      const result = await UserService.deleteUser(ADMIN_ID, OTHER_ID);

      expect(result.ok).toBe(true);
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

  // ----- RBAC: role → permission assignment (finding 1) -----
  describe('role permission assignment', () => {
    function permissionCalls(): unknown[][] {
      // Calls to insert().values() whose argument is an array of permission rows.
      return mockInsertValues.mock.calls.filter(
        (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length > 0 &&
          typeof (c[0] as Record<string, unknown>[])[0]?.['resource'] === 'string',
      );
    }

    it('grants the role permission set when creating a user', async () => {
      pushResponse([]); // username
      pushResponse([]); // email
      mockInsertReturning.mockResolvedValueOnce([makeUser({ id: USER_ID, role: 'developer' })]);

      const result = await UserService.createUser({
        username: 'dev', email: 'dev@test.com', password: 'password123', role: 'developer',
      });

      expect(result.ok).toBe(true);
      const permCall = permissionCalls()[0];
      expect(permCall).toBeDefined();
      const rows = permCall![0] as Record<string, unknown>[];
      expect(rows).toContainEqual({ userId: USER_ID, resource: 'channels', action: 'write', scope: 'all' });
      expect(rows).not.toContainEqual(expect.objectContaining({ resource: 'users', action: 'write' }));
    });

    it('re-syncs permissions and clears sessions cache path when role changes', async () => {
      pushResponse([{ id: USER_ID, role: 'developer' }]); // existing
      pushResponse([makeUser({ role: 'viewer' })]);        // getUser after update

      const result = await UserService.updateUser(USER_ID, { role: 'viewer' }, ADMIN_ID);

      expect(result.ok).toBe(true);
      // Old permissions deleted then viewer set re-inserted.
      expect(mockDelete).toHaveBeenCalled();
      const permCall = permissionCalls()[0];
      expect(permCall).toBeDefined();
      const rows = permCall![0] as Record<string, unknown>[];
      expect(rows).toContainEqual({ userId: USER_ID, resource: 'channels', action: 'read', scope: 'all' });
      expect(rows).not.toContainEqual(expect.objectContaining({ resource: 'channels', action: 'write' }));
    });
  });

  // ----- Session revocation on disable (finding 10) -----
  describe('session revocation', () => {
    it('revokes sessions when a user is disabled via update', async () => {
      pushResponse([{ id: USER_ID, role: 'developer' }]);
      pushResponse([makeUser({ enabled: false })]);

      const result = await UserService.updateUser(USER_ID, { enabled: false }, ADMIN_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('revokes sessions when a user is soft-deleted', async () => {
      pushResponse([{ id: USER_ID, role: 'developer' }]);

      const result = await UserService.deleteUser(USER_ID, ADMIN_ID);

      expect(result.ok).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  // ----- Self password change (finding 8) -----
  describe('changeOwnPassword', () => {
    it('verifies the current password, updates, and clears other sessions', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as unknown as never);
      pushResponse([{ id: USER_ID, passwordHash: '$2a$12$existing' }]);

      const result = await UserService.changeOwnPassword(USER_ID, 'oldPass123', 'newPass123', 'session-1');

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled(); // other sessions removed
    });

    it('rejects when the current password is wrong', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as unknown as never);
      pushResponse([{ id: USER_ID, passwordHash: '$2a$12$existing' }]);

      const result = await UserService.changeOwnPassword(USER_ID, 'wrong', 'newPass123', 'session-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'INVALID_CREDENTIALS');
    });

    it('returns NOT_FOUND when the user does not exist', async () => {
      pushResponse([]);

      const result = await UserService.changeOwnPassword('nope', 'x', 'newPass123', 'session-1');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('getPermissions', () => {
    it('returns the effective permission names for a role', async () => {
      pushResponse([{ role: 'viewer' }]);

      const result = await UserService.getPermissions(USER_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.role).toBe('viewer');
      expect(result.value.permissions).toContain('channels:read');
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
