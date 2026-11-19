import * as path from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';
import { z } from 'zod/v4';

// quiet: dotenv 17+ otherwise prints an unstructured line into the JSON log stream.
loadEnv({ path: '../../.env', quiet: true });
loadEnv({ path: '.env', quiet: true });

const SECOND = 1000;
const DAY = 86_400 * SECOND;

/** Milliseconds per unit, as jsonwebtoken's `ms` package reads them (a year is 365.25 days). */
const UNIT_MS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(ms|msecs?|milliseconds?)$/, 1],
  [/^(s|secs?|seconds?)$/, SECOND],
  [/^(m|mins?|minutes?)$/, 60 * SECOND],
  [/^(h|hrs?|hours?)$/, 3600 * SECOND],
  [/^(d|days?)$/, DAY],
  [/^(w|weeks?)$/, 7 * DAY],
  [/^(y|yrs?|years?)$/, 365.25 * DAY],
];

/**
 * A bare number is null on purpose: jsonwebtoken reads '604800' as milliseconds, not seconds,
 * which nobody setting a token lifetime means. Mirrors `ms`, which jsonwebtoken uses but this
 * package does not depend on.
 */
export function durationMs(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s?([a-z]+)$/i.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const unit = match[2].toLowerCase();
  const perUnit = UNIT_MS.find(([pattern]) => pattern.test(unit))?.[1];
  return perUnit === undefined ? null : Number(match[1]) * perUnit;
}

export const jwtDuration = z
  .string()
  .refine((v) => durationMs(v) !== null, 'must be a number with a unit (ms, s, m, h, d, w or y), such as 15m or 7d')
  .refine((v) => (durationMs(v) ?? 0) > 0, 'must be longer than zero')
  .transform((v) => v as NonNullable<SignOptions['expiresIn']>);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // PEM CA bundle for a hospital or internal CA; TLS still verifies the certificate.
  DATABASE_SSL_CA: z.string().optional(),
  // 'false' turns off certificate verification, a MITM-able PHI link: only for a
  // throwaway self-signed dev setup.
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Server-side limit for one SQL statement, in milliseconds. 0 turns it off.
  // Two minutes leaves room for pruning and backup queries.
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(120_000),

  // Per client address per minute. Read by the rate limiter; declared here so a
  // bad value stops the server at startup instead of being ignored.
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: jwtDuration.default('15m'),
  JWT_REFRESH_EXPIRES_IN: jwtDuration.default('7d'),

  // 'true', 'false', a hop count, or what Express's trust proxy takes ('loopback', IPs).
  TRUST_PROXY: z.string().default('false')
    .transform((v): boolean | number | string => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      const num = Number(v);
      if (!isNaN(num)) return num;
      return v;
    }),

  // Internal hosts (names or IP literals, comma separated) that channel scripts
  // may call with httpFetch although their address is private. Empty: public
  // addresses only.
  SCRIPT_HTTP_ALLOWED_HOSTS: z.string().default('')
    .transform((v): ReadonlyArray<string> => v.split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0)),

  // Directories File sources and File destinations may use (absolute paths,
  // comma separated), with everything under them. Empty: File connectors are
  // off. The server's own directories are refused even inside a root (D-315).
  FILE_CONNECTOR_ROOTS: z.string().default('')
    .transform((v): ReadonlyArray<string> => v.split(',').map((p) => p.trim()).filter((p) => p.length > 0))
    .refine((roots) => roots.every((p) => path.isAbsolute(p)), 'every FILE_CONNECTOR_ROOTS entry must be an absolute path'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_HTTP_HEADERS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // At-rest AES-256-GCM key; required only for channels with encryptData enabled.
  CONTENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CONTENT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .optional(),

  // true serves /metrics without auth, for a network-isolated Prometheus scraper.
  METRICS_PUBLIC: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Swagger UI at /api-docs; on by default outside production.
  API_DOCS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * `min(32)` alone passes the 45-character placeholder in .env.production.example, which would
 * give every un-edited deployment the same publicly known signing key (admin-token forgery).
 */
export function isWeakJwtSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  const placeholderMarkers = ['change_me', 'changeme', 'change-me', 'your-secret', 'your_secret', 'super-secret', 'change-in-production', 'replace', 'example', 'insecure', 'placeholder'];
  if (placeholderMarkers.some((m) => lower.includes(m))) return true;
  // Very few distinct characters means a repeated or patterned value. The bar
  // is 10, not 16: a random hex secret has at most 16 distinct characters and
  // about one in four of them misses at least one digit.
  if (new Set(secret).size < 10) return true;
  return false;
}

export const validatedConfigSchema = configSchema.superRefine((data, ctx) => {
  // A refresh token that dies before the access token it renews makes every
  // session end at the refresh lifetime with a confusing failed refresh.
  const accessMs = durationMs(String(data.JWT_ACCESS_EXPIRES_IN)) ?? 0;
  const refreshMs = durationMs(String(data.JWT_REFRESH_EXPIRES_IN)) ?? 0;
  if (refreshMs < accessMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_REFRESH_EXPIRES_IN'],
      message: `JWT_REFRESH_EXPIRES_IN (${String(data.JWT_REFRESH_EXPIRES_IN)}) must be at least JWT_ACCESS_EXPIRES_IN (${String(data.JWT_ACCESS_EXPIRES_IN)}).`,
    });
  }
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

const result = validatedConfigSchema.safeParse(process.env);

if (!result.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const config = result.data;

export type Config = typeof config;
