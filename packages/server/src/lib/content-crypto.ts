// At-rest encryption of message content for channels with `encryptData` (D-143).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from './service-error.js';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce recommended for GCM
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_PREFIX = 'enc:v1:';

export function isContentEncryptionConfigured(): boolean {
  return typeof config.CONTENT_ENCRYPTION_KEY === 'string' && config.CONTENT_ENCRYPTION_KEY.length > 0;
}

function loadKey(): Buffer {
  const hex = config.CONTENT_ENCRYPTION_KEY;
  if (typeof hex !== 'string' || hex.length === 0) {
    throw new ServiceError('CONFIG_ERROR', 'CONTENT_ENCRYPTION_KEY is not configured');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new ServiceError('CONFIG_ERROR', `CONTENT_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars)`);
  }
  return key;
}

export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

export function encryptContent(plaintext: string): Result<string> {
  return tryCatch(() => {
    const key = loadKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, ciphertext]).toString('base64');
    return `${ENVELOPE_PREFIX}${packed}`;
  });
}

/** Plaintext passes through: rows written before encryptData was enabled are not envelopes. */
export function decryptIfEncrypted(content: string | null): Result<string | null> {
  if (content === null || !isEncryptedEnvelope(content)) {
    return { ok: true, value: content, error: null };
  }
  return decryptContent(content);
}

/** A bad envelope is INTERNAL (500), not bad input: envelopes come from storage. */
export function decryptContent(envelope: string): Result<string> {
  return tryCatch(() => {
    if (!isEncryptedEnvelope(envelope)) {
      throw new ServiceError('INTERNAL', 'Value is not an encrypted content envelope');
    }
    const key = loadKey();
    const packed = Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), 'base64');
    if (packed.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new ServiceError('INTERNAL', 'Encrypted envelope is truncated');
    }
    const iv = packed.subarray(0, IV_BYTES);
    const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  });
}
