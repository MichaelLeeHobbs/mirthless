import { describe, expect, it } from 'vitest';
import { keyToken, looksLikeKeyToken, newKeySecret, parseKeyToken } from '../api-key-token.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('api key tokens', () => {
  it('round-trips a new secret, underscores and all', () => {
    for (let i = 0; i < 50; i++) {
      const secret = newKeySecret();
      expect(secret).toHaveLength(43);
      expect(parseKeyToken(keyToken(ID, secret))).toEqual({ keyId: ID, secret });
    }
    const withUnderscore = `ab_${'c'.repeat(40)}`;
    expect(parseKeyToken(keyToken(ID, withUnderscore))).toEqual({ keyId: ID, secret: withUnderscore });
  });

  it('gives a different secret each time', () => {
    expect(newKeySecret()).not.toBe(newKeySecret());
  });

  it('tells a key token from a JWT', () => {
    expect(looksLikeKeyToken(keyToken(ID, newKeySecret()))).toBe(true);
    expect(looksLikeKeyToken('eyJhbGciOiJIUzI1NiJ9.e30.x')).toBe(false);
  });

  it('refuses anything not exactly shaped like one', () => {
    const secret = newKeySecret();
    for (const bad of [
      '', 'gf_', `gf_${ID}`, `gf_${ID}_`, `gf_${ID}${secret}`, `gf_${ID.toUpperCase()}_${secret}`,
      `gf_not-a-uuid-at-all-not-a-uuid-at-a_${secret}`, `gx_${ID}_${secret}`, `gf_${ID}_${secret}x`, `gf_${ID}_${secret.slice(1)}`,
      `gf_${ID}_${secret.slice(0, 42)}=`, ` gf_${ID}_${secret}`,
    ]) {
      expect(parseKeyToken(bad)).toBeNull();
    }
  });
});
