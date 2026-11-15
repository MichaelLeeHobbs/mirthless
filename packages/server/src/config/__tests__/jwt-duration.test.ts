// ===========================================
// JWT Duration Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { jwtDuration, durationMs, validatedConfigSchema } from '../index.js';

describe('jwtDuration', () => {
  it('accepts the durations jsonwebtoken understands', () => {
    for (const v of ['15m', '7d', '1h', '1 hour', '2 days', '500ms', '1.5h', '2w', '1y']) {
      expect(jwtDuration.safeParse(v).success).toBe(true);
    }
  });

  it('rejects values jsonwebtoken would reject at sign time', () => {
    for (const v of ['', 'forever', '15 fortnights', '-5m', 'm15']) {
      expect(jwtDuration.safeParse(v).success).toBe(false);
    }
  });

  it('rejects a number without a unit, which jsonwebtoken reads as milliseconds', () => {
    for (const v of ['604800', '3600', '0']) {
      const result = jwtDuration.safeParse(v);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/unit/);
    }
  });

  it('rejects a zero duration, which issues an already-expired token', () => {
    for (const v of ['0s', '0d', '0 minutes', '0.0h']) {
      expect(jwtDuration.safeParse(v).success).toBe(false);
    }
  });
});

describe('durationMs', () => {
  it('converts each unit the way jsonwebtoken does', () => {
    expect(durationMs('500ms')).toBe(500);
    expect(durationMs('15m')).toBe(15 * 60_000);
    expect(durationMs('1.5h')).toBe(90 * 60_000);
    expect(durationMs('7d')).toBe(7 * 86_400_000);
    expect(durationMs('2 weeks')).toBe(14 * 86_400_000);
    expect(durationMs('1y')).toBe(365.25 * 86_400_000);
  });

  it('returns null for a value without a unit or not a duration', () => {
    expect(durationMs('3600')).toBeNull();
    expect(durationMs('forever')).toBeNull();
  });
});

describe('token lifetimes', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_SECRET: 'k'.repeat(40) };

  it('accepts the defaults and a refresh lifetime equal to the access lifetime', () => {
    expect(validatedConfigSchema.safeParse(base).success).toBe(true);
    expect(validatedConfigSchema.safeParse({ ...base, JWT_ACCESS_EXPIRES_IN: '1h', JWT_REFRESH_EXPIRES_IN: '60m' }).success).toBe(true);
  });

  it('rejects a refresh lifetime shorter than the access lifetime', () => {
    const result = validatedConfigSchema.safeParse({ ...base, JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '10m' });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === 'JWT_REFRESH_EXPIRES_IN');
    expect(issue?.message).toMatch(/JWT_ACCESS_EXPIRES_IN/);
  });
});
