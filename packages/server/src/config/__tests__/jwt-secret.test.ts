// ===========================================
// JWT Secret Strength Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { isWeakJwtSecret } from '../index.js';

describe('isWeakJwtSecret', () => {
  it('rejects the shipped placeholder secret', () => {
    expect(isWeakJwtSecret('CHANGE_ME_TO_A_RANDOM_STRING_AT_LEAST_32_CHARS')).toBe(true);
  });

  it('rejects common placeholder markers regardless of length', () => {
    for (const s of [
      'your-secret-value-goes-here-please-change',
      'this-is-just-an-example-secret-value-here',
      'replace-this-with-a-real-secret-value-now',
      'insecure-development-secret-key-placeholder',
    ]) {
      expect(isWeakJwtSecret(s)).toBe(true);
    }
  });

  it('rejects low-entropy secrets (few distinct characters)', () => {
    expect(isWeakJwtSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isWeakJwtSecret('abababababababababababababababababab')).toBe(true);
  });

  it('accepts a strong random hex secret', () => {
    // e.g. `openssl rand -hex 32`
    expect(isWeakJwtSecret('9f2c1b7e4a6d8039e5c1a2b3d4f608172635a4b5c6d7e8f90112233445566778')).toBe(false);
  });
});
