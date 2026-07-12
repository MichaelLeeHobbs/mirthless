// ===========================================
// Content Crypto Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg: { CONTENT_ENCRYPTION_KEY: string | undefined } = {
  CONTENT_ENCRYPTION_KEY: 'a'.repeat(64),
};

vi.mock('../../config/index.js', () => ({ config: cfg }));

const {
  encryptContent,
  decryptContent,
  isEncryptedEnvelope,
  isContentEncryptionConfigured,
} = await import('../content-crypto.js');

beforeEach(() => {
  cfg.CONTENT_ENCRYPTION_KEY = 'a'.repeat(64);
});

describe('content-crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'MSH|^~\\&|LAB|HOSPITAL|patient PHI here';
    const enc = encryptContent(plaintext);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;

    expect(isEncryptedEnvelope(enc.value)).toBe(true);
    expect(enc.value).not.toContain('patient PHI');

    const dec = decryptContent(enc.value);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.value).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptContent('same');
    const b = encryptContent('same');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).not.toBe(b.value);
  });

  it('reports whether encryption is configured', () => {
    expect(isContentEncryptionConfigured()).toBe(true);
    cfg.CONTENT_ENCRYPTION_KEY = undefined;
    expect(isContentEncryptionConfigured()).toBe(false);
  });

  it('fails to encrypt when no key is configured', () => {
    cfg.CONTENT_ENCRYPTION_KEY = undefined;
    const result = encryptContent('x');
    expect(result.ok).toBe(false);
  });

  it('fails to decrypt a value that is not an envelope', () => {
    const result = decryptContent('plainish');
    expect(result.ok).toBe(false);
  });

  it('fails to decrypt a tampered envelope (auth tag mismatch)', () => {
    const enc = encryptContent('secret');
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    // Flip characters in the base64 body.
    const tampered = enc.value.slice(0, -4) + (enc.value.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const result = decryptContent(tampered);
    expect(result.ok).toBe(false);
  });

  it('rejects a key of the wrong length', () => {
    cfg.CONTENT_ENCRYPTION_KEY = 'ab';
    const result = encryptContent('x');
    expect(result.ok).toBe(false);
  });
});
