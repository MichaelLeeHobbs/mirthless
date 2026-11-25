import { describe, it, expect } from 'vitest';
import {
  validateAuth,
  makeHostVerifier,
  buildConnectOptions,
  toPathKind,
  wrapSsh2Client,
  type Ssh2ClientInstance,
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

describe('toPathKind', () => {
  const neverCalled = async (): Promise<boolean> => { throw new Error('a non-link must not be followed'); };

  it('maps ssh2-sftp-client exists() types to a directory, a file or missing', async () => {
    expect(await toPathKind('d', neverCalled)).toBe('directory');
    expect(await toPathKind('-', neverCalled)).toBe('file');
    expect(await toPathKind(false, neverCalled)).toBe('missing');
  });

  it('follows a link, so a link to a directory is a directory and a link to a file is a file', async () => {
    expect(await toPathKind('l', async () => true)).toBe('directory');
    expect(await toPathKind('l', async () => false)).toBe('file');
  });
});

describe('wrapSsh2Client mkdir', () => {
  function fakeLibrary(type: false | string, isDirectory: boolean): { lib: Ssh2ClientInstance; mkdirCalls: string[] } {
    const mkdirCalls: string[] = [];
    const lib = {
      exists: async () => type,
      stat: async () => ({ isDirectory }),
      mkdir: async (dir: string) => { mkdirCalls.push(dir); return 'ok'; },
    } as unknown as Ssh2ClientInstance;
    return { lib, mkdirCalls };
  }

  it('does not create a directory that is a link to a directory', async () => {
    const { lib, mkdirCalls } = fakeLibrary('l', true);
    await wrapSsh2Client(lib, makeOptions()).mkdir('/linked');
    expect(mkdirCalls).toEqual([]);
  });

  it('does not create a directory that already exists', async () => {
    const { lib, mkdirCalls } = fakeLibrary('d', true);
    await wrapSsh2Client(lib, makeOptions()).mkdir('/inbound');
    expect(mkdirCalls).toEqual([]);
  });

  it('creates a missing directory', async () => {
    const { lib, mkdirCalls } = fakeLibrary(false, false);
    await wrapSsh2Client(lib, makeOptions()).mkdir('/new');
    expect(mkdirCalls).toEqual(['/new']);
  });
});

describe('wrapSsh2Client stat', () => {
  function statWith(stat: () => Promise<unknown>): ReturnType<ReturnType<typeof wrapSsh2Client>['stat']> {
    return wrapSsh2Client({ stat } as unknown as Ssh2ClientInstance, makeOptions()).stat('/in/a');
  }

  it('is the size and time of the file', async () => {
    expect(await statWith(async () => ({ size: 5, modifyTime: 1_000, isDirectory: false }))).toEqual({ size: 5, modifyTime: 1_000 });
  });

  it('is null when the file is not there', async () => {
    expect(await statWith(() => Promise.reject(Object.assign(new Error('No such file'), { code: 'ENOENT' })))).toBeNull();
  });

  it('rejects when the server refuses or the connection is gone', async () => {
    await expect(statWith(() => Promise.reject(Object.assign(new Error('Permission denied'), { code: 3 })))).rejects.toThrow('Permission denied');
    await expect(statWith(() => Promise.reject(new Error('No SFTP connection available')))).rejects.toThrow('No SFTP connection');
  });
});

describe('wrapSsh2Client replace', () => {
  function replaceWith(posixRename: () => Promise<string>): Promise<boolean> {
    return wrapSsh2Client({ posixRename } as unknown as Ssh2ClientInstance, makeOptions()).replace('/out/a', '/out/b');
  }

  it('is true when the server renamed over the file', async () => {
    expect(await replaceWith(async () => 'ok')).toBe(true);
  });

  it('is false when the server answers that it does not support it', async () => {
    expect(await replaceWith(() => Promise.reject(Object.assign(new Error('Operation unsupported'), { code: 8 })))).toBe(false);
  });

  it('rejects when the server refuses', async () => {
    await expect(replaceWith(() => Promise.reject(Object.assign(new Error('Permission denied'), { code: 3 })))).rejects.toThrow('Permission denied');
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

  it('forwards a handshake timeout as ssh2 readyTimeout only when set', () => {
    expect(buildConnectOptions(makeOptions({ readyTimeoutMs: 10_000 }))['readyTimeout']).toBe(10_000);
    expect('readyTimeout' in buildConnectOptions(makeOptions({}))).toBe(false);
  });
});
