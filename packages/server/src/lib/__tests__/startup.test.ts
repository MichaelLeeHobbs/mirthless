// ===========================================
// Startup Configuration Tests
// ===========================================
// Validates the config schema used at server startup.
// We recreate the schema here rather than importing from config/index.ts,
// because that module calls process.exit(1) on validation failure.

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  TRUST_PROXY: z.string().default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const validEnv = {
  NODE_ENV: 'production',
  PORT: '3000',
  FRONTEND_URL: 'https://mirthless.example.com',
  DATABASE_URL: 'postgresql://user:pass@db:5432/mirthless',
  DATABASE_SSL: 'false',
  JWT_SECRET: 'a-very-long-secret-string-that-is-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  TRUST_PROXY: 'true',
  LOG_LEVEL: 'info',
} as const;

describe('Config schema', () => {
  it('accepts valid production-like env vars', () => {
    const result = configSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NODE_ENV).toBe('production');
    expect(result.data.PORT).toBe(3000);
    expect(result.data.FRONTEND_URL).toBe('https://mirthless.example.com');
    expect(result.data.DATABASE_URL).toBe('postgresql://user:pass@db:5432/mirthless');
    expect(result.data.JWT_SECRET).toBe('a-very-long-secret-string-that-is-at-least-32-characters');
    expect(result.data.TRUST_PROXY).toBe('true');
    expect(result.data.LOG_LEVEL).toBe('info');
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _, ...envWithoutDb } = validEnv;
    const result = configSchema.safeParse(envWithoutDb);
    expect(result.success).toBe(false);
  });

  it('rejects JWT_SECRET shorter than 32 chars', () => {
    const result = configSchema.safeParse({ ...validEnv, JWT_SECRET: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('rejects missing JWT_SECRET', () => {
    const { JWT_SECRET: _, ...envWithoutJwt } = validEnv;
    const result = configSchema.safeParse(envWithoutJwt);
    expect(result.success).toBe(false);
  });

  it('applies correct defaults when optional fields are omitted', () => {
    const minimal = {
      DATABASE_URL: 'postgresql://user:pass@db:5432/mirthless',
      JWT_SECRET: 'a-very-long-secret-string-that-is-at-least-32-characters',
    };
    const result = configSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.PORT).toBe(3000);
    expect(result.data.FRONTEND_URL).toBe('http://localhost:5173');
    expect(result.data.DATABASE_SSL).toBe('false');
    expect(result.data.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(result.data.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    expect(result.data.TRUST_PROXY).toBe('false');
    expect(result.data.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string to number', () => {
    const result = configSchema.safeParse({ ...validEnv, PORT: '8080' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(8080);
  });

  describe('LOG_LEVEL enum', () => {
    it.each(['debug', 'info', 'warn', 'error'] as const)(
      'accepts LOG_LEVEL=%s',
      (level) => {
        const result = configSchema.safeParse({ ...validEnv, LOG_LEVEL: level });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.LOG_LEVEL).toBe(level);
      }
    );

    it('rejects invalid LOG_LEVEL', () => {
      const result = configSchema.safeParse({ ...validEnv, LOG_LEVEL: 'trace' });
      expect(result.success).toBe(false);
    });
  });

  describe('NODE_ENV enum', () => {
    it.each(['development', 'production', 'test'] as const)(
      'accepts NODE_ENV=%s',
      (env) => {
        const result = configSchema.safeParse({ ...validEnv, NODE_ENV: env });
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.NODE_ENV).toBe(env);
      }
    );

    it('rejects invalid NODE_ENV', () => {
      const result = configSchema.safeParse({ ...validEnv, NODE_ENV: 'staging' });
      expect(result.success).toBe(false);
    });
  });

  it('rejects invalid DATABASE_URL (not a URL)', () => {
    const result = configSchema.safeParse({ ...validEnv, DATABASE_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid FRONTEND_URL (not a URL)', () => {
    const result = configSchema.safeParse({ ...validEnv, FRONTEND_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid DATABASE_SSL value', () => {
    const result = configSchema.safeParse({ ...validEnv, DATABASE_SSL: 'yes' });
    expect(result.success).toBe(false);
  });
});
