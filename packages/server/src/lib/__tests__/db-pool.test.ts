// ===========================================
// Database pool configuration tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';

const cfg = vi.hoisted(() => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/x_test',
  DATABASE_SSL: false,
  DATABASE_SSL_REJECT_UNAUTHORIZED: true,
  DATABASE_SSL_CA: undefined as string | undefined,
  DATABASE_STATEMENT_TIMEOUT_MS: 120_000,
}));
vi.mock('../../config/index.js', () => ({ config: cfg }));
vi.mock('../logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { buildPoolConfig } = await import('../db.js');

describe('buildPoolConfig', () => {
  it('gives every statement a time limit so a stuck query cannot hold a connection for good', () => {
    expect(buildPoolConfig().statement_timeout).toBe(120_000);
  });

  it('uses the configured limit', () => {
    cfg.DATABASE_STATEMENT_TIMEOUT_MS = 5_000;
    expect(buildPoolConfig().statement_timeout).toBe(5_000);
  });

  it('sets no limit when the setting is 0', () => {
    cfg.DATABASE_STATEMENT_TIMEOUT_MS = 0;
    expect(buildPoolConfig().statement_timeout).toBeUndefined();
  });
});
