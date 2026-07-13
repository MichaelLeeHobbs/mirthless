// ===========================================
// SFTP Client Abstraction Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  validateAuth,
  makeHostVerifier,
  buildConnectOptions,
  type SftpConnectionOptions,
} from '../sftp-client.js';

function makeOptions(overrides?: Partial<SftpConnectionOptions>): SftpConnectionOptions {
  return {
    host: 'sftp.hospital.org',
    port: 22,
    username: 'labuser',
    password: 'secret',
    strictHostKey: false,
    ...overrides,
  };
}

describe('validateAuth', () => {
  it('accepts a password', () => {
    expect(validateAuth(makeOptions({ password: 'pw', privateKey: undefined }))).toBeNull();
  });

  it('accepts a private key', () => {
    expect(validateAuth(makeOptions({ password: undefined, privateKey: '-----BEGIN-----' }))).toBeNull();
  });

  it('rejects when both password and privateKey are absent', () => {
    const msg = validateAuth(makeOptions({ password: undefined, privateKey: undefined }));
    expect(msg).not.toBeNull();
    expect(msg).toContain('password or a privateKey');
  });

  it('treats an empty-string password as absent', () => {
    expect(validateAuth(makeOptions({ password: '', privateKey: undefined }))).not.toBeNull();
  });

  it('treats an empty-string privateKey as absent', () => {
    expect(validateAuth(makeOptions({ password: undefined, privateKey: '' }))).not.toBeNull();
  });
});

describe('makeHostVerifier', () => {
  it('returns undefined when strict host-key checking is disabled', () => {
    expect(makeHostVerifier(makeOptions({ strictHostKey: false }))).toBeUndefined();
  });

  it('accepts a matching base64 host key', () => {
    const key = Buffer.from('server-public-key');
    const verifier = makeHostVerifier(makeOptions({ strictHostKey: true, hostKey: key.toString('base64') }));
    expect(verifier).toBeDefined();
    expect(verifier!(key)).toBe(true);
  });

  it('rejects a mismatched host key', () => {
    const verifier = makeHostVerifier(makeOptions({ strictHostKey: true, hostKey: 'AAAAexpected' }));
    expect(verifier!(Buffer.from('different-key'))).toBe(false);
  });

  it('rejects everything when strict is on but no hostKey is configured', () => {
    const verifier = makeHostVerifier(makeOptions({ strictHostKey: true, hostKey: undefined }));
    expect(verifier!(Buffer.from('any-key'))).toBe(false);
  });
});

describe('buildConnectOptions', () => {
  it('includes host, port, and username', () => {
    const opts = buildConnectOptions(makeOptions());
    expect(opts['host']).toBe('sftp.hospital.org');
    expect(opts['port']).toBe(22);
    expect(opts['username']).toBe('labuser');
  });

  it('forwards a password only when present', () => {
    expect(buildConnectOptions(makeOptions({ password: 'pw' }))['password']).toBe('pw');
    expect('password' in buildConnectOptions(makeOptions({ password: undefined, privateKey: 'k' }))).toBe(false);
  });

  it('forwards privateKey and passphrase when present', () => {
    const opts = buildConnectOptions(makeOptions({ password: undefined, privateKey: 'PEM', passphrase: 'pp' }));
    expect(opts['privateKey']).toBe('PEM');
    expect(opts['passphrase']).toBe('pp');
  });

  it('omits hostVerifier when strict checking is off', () => {
    expect('hostVerifier' in buildConnectOptions(makeOptions({ strictHostKey: false }))).toBe(false);
  });

  it('includes hostVerifier when strict checking is on', () => {
    const opts = buildConnectOptions(makeOptions({ strictHostKey: true, hostKey: 'abc' }));
    expect(typeof opts['hostVerifier']).toBe('function');
  });
});
