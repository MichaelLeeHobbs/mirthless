// ===========================================
// Application Configuration
// ===========================================
// Validates environment variables at startup using Zod.
// If validation fails, the app exits immediately.

import { config as loadEnv } from 'dotenv';
import { z } from 'zod/v4';

// Load .env from project root and local fallback
loadEnv({ path: '../../.env' });
loadEnv({ path: '.env' });

const configSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // Authentication
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Proxy — accepts 'true', 'false', 'loopback', number, or specific IPs
  TRUST_PROXY: z.string().default('false')
    .transform((v): boolean | number | string => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      const num = Number(v);
      if (!isNaN(num)) return num;
      return v;
    }),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_HTTP_HEADERS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // At-rest content encryption key (AES-256-GCM). 64 hex chars = 32 bytes.
  // Optional; required only for channels with encryptData enabled.
  CONTENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CONTENT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .optional(),

  // Observability exposure — default to protected/off in production.
  // METRICS_PUBLIC=true exposes /metrics without auth (for a network-isolated
  // Prometheus scraper). Otherwise /metrics requires auth.
  METRICS_PUBLIC: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Serve the Swagger UI at /api-docs. Defaults on outside production.
  API_DOCS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * A JWT secret is unusable in production if it is a shipped placeholder or an
 * obviously low-entropy value. `min(32)` alone passes the 45-char placeholder in
 * .env.production.example, which would give every un-edited deployment the same
 * publicly-known signing key (admin-token forgery). We reject those in production.
 */
export function isWeakJwtSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  const placeholderMarkers = ['change_me', 'changeme', 'change-me', 'your-secret', 'your_secret', 'replace', 'example', 'insecure', 'placeholder'];
  if (placeholderMarkers.some((m) => lower.includes(m))) return true;
  // Fewer than 16 distinct characters => very low entropy for a 32+ char secret.
  if (new Set(secret).size < 16) return true;
  return false;
}

const refinedSchema = configSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && isWeakJwtSecret(data.JWT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message:
        'JWT_SECRET looks like a placeholder or low-entropy value. Set a strong, random secret in production ' +
        '(e.g. `openssl rand -hex 32`). Refusing to start with a guessable signing key.',
    });
  }
});

const result = refinedSchema.safeParse(process.env);

if (!result.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const config = result.data;

export type Config = typeof config;
