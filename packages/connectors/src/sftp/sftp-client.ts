import { createRequire } from 'node:module';
import type { Writable } from 'node:stream';
import type { FileVersion } from '../quarantine-ledger.js';

// The package is ESM, so a bare `require` is undefined at runtime (vitest
// injects one, which hid this). Load the CJS client library through createRequire.
const require = createRequire(import.meta.url);

/** At least one of password and privateKey must be set; {@link validateAuth} checks it. */
export interface SftpConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string | undefined;
  readonly privateKey?: string | undefined;
  readonly passphrase?: string | undefined;
  readonly strictHostKey: boolean;
  readonly hostKey?: string | undefined;
  /** ssh2's `readyTimeout` for the SSH handshake; ssh2's default of 20 s when unset. */
  readonly readyTimeoutMs?: number | undefined;
}

export interface SftpFileInfo {
  readonly name: string;
  readonly size: number;
  /** Last-modified time in epoch milliseconds. */
  readonly modifyTime: number;
  /** False for directories and links. */
  readonly isFile: boolean;
}

/**
 * Links followed. ssh2-sftp-client's exists() answers false for a FIFO,
 * socket or device, so those read as missing.
 */
export type SftpPathKind = 'directory' | 'file' | 'missing';

export interface SftpClient {
  connect(): Promise<void>;
  list(remoteDirectory: string): Promise<readonly SftpFileInfo[]>;
  get(remotePath: string): Promise<Buffer>;
  /** `null` when the server answers that the file is not there, or only that it failed, which the library reads as the same. */
  stat(remotePath: string): Promise<FileVersion | null>;
  /** Overwrites. `onOpen` runs once the server has opened the file, so from when part of the data may be in it. */
  put(data: Buffer, remotePath: string, onOpen?: () => void): Promise<void>;
  /** Creates the file if absent. `onOpen` as for {@link put}. */
  append(data: Buffer, remotePath: string, onOpen?: () => void): Promise<void>;
  delete(remotePath: string): Promise<void>;
  /** Whether an existing `to` is replaced is up to the server. */
  rename(from: string, to: string): Promise<void>;
  /** Renames over an existing `to` in one step. False, with nothing done, on a server that cannot. */
  replace(from: string, to: string): Promise<boolean>;
  /** Recursive; no-op if it already exists. */
  mkdir(remoteDirectory: string): Promise<void>;
  /** A link counts as what it points to. */
  pathKind(remotePath: string): Promise<SftpPathKind>;
  /** Also gives up a connect in progress, which may then never settle. */
  end(): Promise<void>;
}

export type SftpClientFactory = (options: SftpConnectionOptions) => SftpClient;

/** Callers fail with this at deploy/connect time, so an unauthenticated connect is never attempted. */
export function validateAuth(options: SftpConnectionOptions): string | null {
  const hasPassword = typeof options.password === 'string' && options.password.length > 0;
  const hasKey = typeof options.privateKey === 'string' && options.privateKey.length > 0;
  if (!hasPassword && !hasKey) {
    return 'SFTP auth requires a password or a privateKey; neither was provided';
  }
  return null;
}

function normalizeHostKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ');
}

/**
 * Strict checking is on by default so PHI never crosses a connection an
 * ARP/DNS attacker could MITM. The whole key is compared, not a fingerprint:
 * the operator pastes the base64 key blob (the third field of `ssh-keyscan`
 * output); a `SHA256:` fingerprint never matches.
 */
export function makeHostVerifier(
  options: SftpConnectionOptions,
): ((key: Buffer) => boolean) | undefined {
  if (!options.strictHostKey) return undefined;
  const expected = options.hostKey ? normalizeHostKey(options.hostKey) : '';
  return (key: Buffer): boolean => {
    if (!expected) return false;
    const presentedB64 = normalizeHostKey(key.toString('base64'));
    const presentedRaw = normalizeHostKey(key.toString('utf8'));
    return presentedB64 === expected || presentedRaw === expected;
  };
}

interface Ssh2FileInfo {
  readonly type: string;
  readonly name: string;
  readonly size: number;
  readonly modifyTime: number;
}

export interface Ssh2ClientInstance {
  connect(options: Record<string, unknown>): Promise<unknown>;
  list(remoteDir: string): Promise<readonly Ssh2FileInfo[]>;
  get(remotePath: string): Promise<Buffer>;
  createWriteStream(remotePath: string, options: { readonly flags: 'w' | 'a' }): Writable;
  delete(remotePath: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  posixRename(from: string, to: string): Promise<string>;
  mkdir(remoteDir: string, recursive: boolean): Promise<string>;
  exists(remotePath: string): Promise<false | string>;
  stat(remotePath: string): Promise<{ readonly isDirectory: boolean; readonly size: number; readonly modifyTime: number }>;
  end(): Promise<boolean>;
  /** The ssh2 client, which holds the connection. */
  readonly client: { destroy(): unknown };
}

/** ssh2-sftp-client's exists() answers 'd', '-', 'l' or false; it uses lstat, so a link is 'l'. */
export async function toPathKind(type: false | string, isDirectoryTarget: () => Promise<boolean>): Promise<SftpPathKind> {
  if (type === false) return 'missing';
  if (type === 'd') return 'directory';
  if (type === 'l') return (await isDirectoryTarget()) ? 'directory' : 'file';
  return 'file';
}

/** An empty string is never sent as a credential. */
export function buildConnectOptions(options: SftpConnectionOptions): Record<string, unknown> {
  const verifier = makeHostVerifier(options);
  return {
    host: options.host,
    port: options.port,
    username: options.username,
    ...(options.password ? { password: options.password } : {}),
    ...(options.privateKey ? { privateKey: options.privateKey } : {}),
    ...(options.passphrase ? { passphrase: options.passphrase } : {}),
    ...(verifier ? { hostVerifier: verifier } : {}),
    ...(options.readyTimeoutMs !== undefined ? { readyTimeout: options.readyTimeoutMs } : {}),
  };
}

export function createSsh2SftpClient(options: SftpConnectionOptions): SftpClient {
  const Ctor = require('ssh2-sftp-client') as new (name: string, callbacks: object) => Ssh2ClientInstance;
  // Without callbacks of its own it prints a lost connection with console.log; the next operation rejects either way.
  return wrapSsh2Client(new Ctor('sftp', {}), options);
}

/**
 * Not the library's put() and append(): they answer success when the server refuses a
 * write part-way (a full disk), because the stream is destroyed before its error is seen.
 */
function writeAll(stream: Writable, data: Buffer, onOpen: (() => void) | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.once('open', () => onOpen?.());
    stream.once('close', resolve);
    stream.write(data, (err) => {
      if (err) reject(err);
      else stream.end();
    });
  });
}

/** SSH_FX_OP_UNSUPPORTED, from a server that names the extension and does not carry it out. */
const OP_UNSUPPORTED = 8;

function lacksExtension(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // ssh2's own error, before anything is sent, has no code.
  return err.message.includes('does not support this extended request') || ('code' in err && err.code === OP_UNSUPPORTED);
}

async function replace(client: Ssh2ClientInstance, from: string, to: string): Promise<boolean> {
  try {
    await client.posixRename(from, to);
    return true;
  } catch (err) {
    if (lacksExtension(err)) return false;
    throw err;
  }
}

async function stat(client: Ssh2ClientInstance, remotePath: string): Promise<FileVersion | null> {
  try {
    const { modifyTime, size } = await client.stat(remotePath);
    return { modifyTime, size };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function makePathKind(client: Ssh2ClientInstance): SftpClient['pathKind'] {
  return async (remotePath) => toPathKind(await client.exists(remotePath), async () => (await client.stat(remotePath)).isDirectory);
}

type FileChanges = Pick<SftpClient, 'put' | 'append' | 'delete' | 'rename' | 'replace'>;

function fileChanges(client: Ssh2ClientInstance): FileChanges {
  return {
    put: (data, remotePath, onOpen) => writeAll(client.createWriteStream(remotePath, { flags: 'w' }), data, onOpen),
    append: (data, remotePath, onOpen) => writeAll(client.createWriteStream(remotePath, { flags: 'a' }), data, onOpen),
    async delete(remotePath: string): Promise<void> {
      await client.delete(remotePath);
    },
    async rename(from: string, to: string): Promise<void> {
      await client.rename(from, to);
    },
    replace: (from, to) => replace(client, from, to),
  };
}

export function wrapSsh2Client(client: Ssh2ClientInstance, options: SftpConnectionOptions): SftpClient {
  const pathKind = makePathKind(client);
  return {
    ...fileChanges(client),
    async connect(): Promise<void> {
      await client.connect(buildConnectOptions(options));
    },
    async list(remoteDirectory: string): Promise<readonly SftpFileInfo[]> {
      const entries = await client.list(remoteDirectory);
      return entries.map((e) => ({
        name: e.name,
        size: e.size,
        modifyTime: e.modifyTime,
        isFile: e.type === '-',
      }));
    },
    stat: (remotePath) => stat(client, remotePath),
    async get(remotePath: string): Promise<Buffer> {
      return client.get(remotePath);
    },
    async mkdir(remoteDirectory: string): Promise<void> {
      // ssh2-sftp-client's mkdir refuses a link to a directory as "already
      // exists as a file", so follow links before deciding to create it.
      if ((await pathKind(remoteDirectory)) === 'directory') return;
      await client.mkdir(remoteDirectory, true);
    },
    pathKind,
    async end(): Promise<void> {
      await client.end();
      // While no SFTP session is up the library's end() closes nothing. Not ssh2's end():
      // it waits for a server that may never close its side.
      client.client.destroy();
    },
  };
}
