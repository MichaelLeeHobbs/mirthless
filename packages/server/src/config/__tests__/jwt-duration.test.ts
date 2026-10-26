// ===========================================
// JWT Duration Validation Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { jwtDuration } from '../index.js';

describe('jwtDuration', () => {
  it('accepts the durations jsonwebtoken understands', () => {
    for (const v of ['15m', '7d', '1h', '3600', '1 hour', '2 days', '500ms', '1.5h']) {
      expect(jwtDuration.safeParse(v).success).toBe(true);
    }
  });

  it('rejects values jsonwebtoken would reject at sign time', () => {
    for (const v of ['', 'forever', '15 fortnights', '-5m', 'm15']) {
      expect(jwtDuration.safeParse(v).success).toBe(false);
    }
  });
});
