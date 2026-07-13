// ===========================================
// Content Encryption (at-rest)
// ===========================================
// AES-256-GCM authenticated encryption for message content when a channel has
// `encryptData` enabled. The key is derived from the CONTENT_ENCRYPTION_KEY
// environment variable (64 hex chars = 32 bytes), validated at startup.
//
// WIRED: the message store adapter (packages/server/src/engine.ts) calls
// `encryptContent()` before persisting content rows for channels with
// `encryptData` true (setting message_content.is_encrypted). Read paths
// (MessageService.loadContent, MessageQueryService.getMessageDetail,
// MessageReprocessService) call `decryptIfEncrypted()`, which decrypts only
// self-describing envelopes so mixed plaintext/ciphertext rows both read back
// correctly. EngineManager.deploy() refuses to deploy an encryptData channel
// when no key is configured. See docs/progress/DECISIONS.md (D-143).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from './service-error.js';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce recommended for GCM
const KEY_BYTES = 32; // AES-256
const AUTH_TAG_BYTES = 16;
/** Marker prefix so encrypted blobs are self-describing and versioned. */
const ENVELOPE_PREFIX = 'enc:v1:';

/** True when a content-encryption key is configured. */
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

/** True when the given string is a content-crypto envelope produced by encryptContent. */
export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Encrypt UTF-8 plaintext into a self-describing base64 envelope:
 * `enc:v1:<base64(iv | authTag | ciphertext)>`.
 */
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

/**
 * Decrypt content read from storage when it is an encrypted envelope; otherwise
 * return it unchanged. This lets mixed plaintext/ciphertext rows (written before
 * and after encryptData was enabled) both read back correctly. A `null` value
 * (absent content) passes through untouched. Decryption of a genuine envelope
 * fails loudly (missing key, tampering) rather than returning ciphertext.
 */
export function decryptIfEncrypted(content: string | null): Result<string | null> {
  if (content === null || !isEncryptedEnvelope(content)) {
    return { ok: true, value: content, error: null };
  }
  return decryptContent(content);
}

/**
 * Decrypt an envelope produced by encryptContent back to UTF-8 plaintext.
 * A tampered or malformed envelope fails loudly (never returns partial data).
 */
export function decryptContent(envelope: string): Result<string> {
  return tryCatch(() => {
    if (!isEncryptedEnvelope(envelope)) {
      throw new ServiceError('INVALID_INPUT', 'Value is not an encrypted content envelope');
    }
    const key = loadKey();
    const packed = Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), 'base64');
    if (packed.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new ServiceError('INVALID_INPUT', 'Encrypted envelope is truncated');
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
