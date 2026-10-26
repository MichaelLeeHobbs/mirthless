// ===========================================
// Seed Options Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { demoDataEnabled } from '../seed-options.js';

describe('demoDataEnabled', () => {
  it('is off in production by default', () => {
    expect(demoDataEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on outside production by default', () => {
    expect(demoDataEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(demoDataEnabled({})).toBe(true);
  });

  it('honors an explicit SEED_DEMO_DATA in either direction', () => {
    expect(demoDataEnabled({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true' })).toBe(true);
    expect(demoDataEnabled({ NODE_ENV: 'development', SEED_DEMO_DATA: 'false' })).toBe(false);
  });
});
