// ===========================================
// JWT Secret Strength Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import { isWeakJwtSecret } from '../index.js';

describe('isWeakJwtSecret', () => {
  it('rejects the shipped placeholder secret', () => {
    expect(isWeakJwtSecret('CHANGE_ME_TO_A_RANDOM_STRING_AT_LEAST_32_CHARS')).toBe(true);
  });

  it('rejects the secret shipped in .env.example', () => {
    expect(isWeakJwtSecret('your-super-secret-key-change-in-production-minimum-32-chars')).toBe(true);
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

  it('accepts a random hex secret that happens to miss some of the 16 hex digits', () => {
    // About one in four `openssl rand -hex 32` values lacks at least one digit.
    // This one has no "f": 15 distinct characters, 250 bits of entropy.
    expect(isWeakJwtSecret('0123456789abcde0123456789abcde0123456789abcde0123456789abcde0a1b')).toBe(false);
    expect(isWeakJwtSecret('3a9c1e07b2d48a6c0e915b37d2a4c68e0b1973a5d2c4e86a0b3d5c7e9a1b2c4d')).toBe(false);
  });

  it('accepts the secret the Docker smoke test starts the server with', () => {
    expect(isWeakJwtSecret('ci-smoke-secret-that-is-at-least-32-characters')).toBe(false);
  });

  it('accepts a strong random hex secret', () => {
    // e.g. `openssl rand -hex 32`
    expect(isWeakJwtSecret('9f2c1b7e4a6d8039e5c1a2b3d4f608172635a4b5c6d7e8f90112233445566778')).toBe(false);
  });
});
