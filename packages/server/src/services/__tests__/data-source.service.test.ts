// ===========================================
// Data Source Service Tests (unit)
// ===========================================
// The happy paths (CRUD, runQuery, read-only enforcement, row cap, redaction)
// are covered by data-source.itest.ts against real Postgres. This unit test
// covers the fail-loud-without-encryption-key guard, which integration (which
// always has the key configured) cannot exercise.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const selectWhere = vi.fn().mockResolvedValue([]); // no duplicate name

const mockDb = {
  select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_c: unknown, v: unknown) => ({ v })),
  asc: vi.fn(() => ({})),
}));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));
vi.mock('../data-source-pool-manager.js', () => ({
  dataSourcePoolManager: { invalidate: vi.fn(), runQuery: vi.fn(), shutdown: vi.fn() },
}));

const mockIsConfigured = vi.fn();
vi.mock('../../lib/content-crypto.js', () => ({
  isContentEncryptionConfigured: () => mockIsConfigured(),
  encryptContent: (s: string) => ({ ok: true, value: `enc:${s}` }),
  decryptContent: (s: string) => ({ ok: true, value: s.replace(/^enc:/, '') }),
}));

const { DataSourceService } = await import('../data-source.service.js');

const input = {
  name: 'reporting-db', description: '', driver: 'postgres' as const, host: 'db', port: 5432,
  database: 'reports', user: 'ro', password: 'secret', readOnly: true,
  maxConnections: 5, statementTimeoutMs: 30_000, maxRows: 10_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  selectWhere.mockResolvedValue([]);
});

describe('DataSourceService.create — credential encryption guard', () => {
  it('refuses to create when CONTENT_ENCRYPTION_KEY is not configured (fail loud)', async () => {
    mockIsConfigured.mockReturnValue(false);

    const result = await DataSourceService.create(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveProperty('code', 'CONFIG_ERROR');
    expect(mockDb.insert).not.toHaveBeenCalled(); // never wrote a row
  });

  it('encrypts the password before inserting when a key is configured', async () => {
    mockIsConfigured.mockReturnValue(true);
    const returning = vi.fn().mockResolvedValue([{
      id: 'id-1', name: input.name, description: '', driver: 'postgres', host: 'db', port: 5432,
      database: 'reports', dbUser: 'ro', passwordEncrypted: 'enc:secret', readOnly: true,
      maxConnections: 5, statementTimeoutMs: 30_000, maxRows: 10_000, createdAt: new Date(), updatedAt: new Date(),
    }]);
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });

    const result = await DataSourceService.create(input);

    expect(result.ok).toBe(true);
    const values = (mockDb.insert.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> }).values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ passwordEncrypted: 'enc:secret' }));
    // Response never carries the password.
    if (!result.ok) return;
    expect((result.value as unknown as Record<string, unknown>)['password']).toBeUndefined();
    expect((result.value as unknown as Record<string, unknown>)['passwordEncrypted']).toBeUndefined();
  });
});
