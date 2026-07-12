// ===========================================
// SFTP Client Abstraction
// ===========================================
// A small injectable interface over an SFTP client (default: ssh2-sftp-client)
// so the receiver/dispatcher are unit-testable WITHOUT a real SFTP server.
// Mirrors the SmtpTransport / ImapClient factory-DI pattern in this package.
// Never logs credentials or private keys.

// ----- Connection options -----

/**
 * Connection parameters shared by the SFTP source and destination.
 * Auth is password OR privateKey (with optional passphrase); at least one of
 * the two credentials MUST be present — {@link validateAuth} enforces this.
 */
export interface SftpConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string | undefined;
  readonly privateKey?: string | undefined;
  readonly passphrase?: string | undefined;
  /** When true, verify the server host key against {@link hostKey}. */
  readonly strictHostKey: boolean;
  readonly hostKey?: string | undefined;
}

// ----- File listing -----

/** A remote file entry returned by {@link SftpClient.list}. */
export interface SftpFileInfo {
  readonly name: string;
  readonly size: number;
  /** Last-modified time in epoch milliseconds. */
  readonly modifyTime: number;
  /** True for regular files; directories/links are skipped by the receiver. */
  readonly isFile: boolean;
}

// ----- Client -----

/**
 * Abstraction over an SFTP client. Structurally satisfied by the default
 * ssh2-sftp-client wrapper ({@link createSsh2SftpClient}) but narrow enough to
 * mock in tests without a real server.
 */
export interface SftpClient {
  connect(): Promise<void>;
  list(remoteDirectory: string): Promise<readonly SftpFileInfo[]>;
  /** Download a remote file's full content as a Buffer. */
  get(remotePath: string): Promise<Buffer>;
  /** Write (overwrite) a remote file. */
  put(data: Buffer, remotePath: string): Promise<void>;
  /** Append to a remote file (creating it if absent). */
  append(data: Buffer, remotePath: string): Promise<void>;
  delete(remotePath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Create a directory (recursively). No-op if it already exists. */
  mkdir(remoteDirectory: string): Promise<void>;
  /** True if the path exists (any type). */
  exists(remotePath: string): Promise<boolean>;
  end(): Promise<void>;
}

/** Factory that builds an {@link SftpClient} from connection options. */
export type SftpClientFactory = (options: SftpConnectionOptions) => SftpClient;

// ----- Auth validation -----

/**
 * Ensure at least one credential is configured. Returns an error message when
 * both password and privateKey are absent, otherwise null. Callers fail loudly
 * with this at deploy/connect time — an unauthenticated SFTP connect is never
 * silently attempted.
 */
export function validateAuth(options: SftpConnectionOptions): string | null {
  const hasPassword = typeof options.password === 'string' && options.password.length > 0;
  const hasKey = typeof options.privateKey === 'string' && options.privateKey.length > 0;
  if (!hasPassword && !hasKey) {
    return 'SFTP auth requires a password or a privateKey; neither was provided';
  }
  return null;
}

// ----- Host key verification -----

/** Normalize a host key string for comparison (trim + collapse whitespace). */
function normalizeHostKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ');
}

/**
 * Build the ssh2 `hostVerifier` for strict host-key checking. Returns undefined
 * when strict checking is disabled (lenient default — many internal SFTP hosts
 * use self-signed keys). When enabled, the presented key is accepted only if it
 * matches the configured {@link SftpConnectionOptions.hostKey} (compared as
 * base64 or as the raw provided string). A missing hostKey rejects everything.
 */
export function makeHostVerifier(
  options: SftpConnectionOptions,
): ((key: Buffer) => boolean) | undefined {
  if (!options.strictHostKey) return undefined;
  const expected = options.hostKey ? normalizeHostKey(options.hostKey) : '';
  return (key: Buffer): boolean => {
    if (!expected) return false; // strict mode but no key configured → reject all
    const presentedB64 = normalizeHostKey(key.toString('base64'));
    const presentedRaw = normalizeHostKey(key.toString('utf8'));
    return presentedB64 === expected || presentedRaw === expected;
  };
}

// ----- Default ssh2-sftp-client factory -----

interface Ssh2FileInfo {
  readonly type: string;
  readonly name: string;
  readonly size: number;
  readonly modifyTime: number;
}

interface Ssh2ClientInstance {
  connect(options: Record<string, unknown>): Promise<unknown>;
  list(remoteDir: string): Promise<readonly Ssh2FileInfo[]>;
  get(remotePath: string): Promise<Buffer>;
  put(input: Buffer, remotePath: string): Promise<string>;
  append(input: Buffer, remotePath: string): Promise<string>;
  delete(remotePath: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  mkdir(remoteDir: string, recursive: boolean): Promise<string>;
  exists(remotePath: string): Promise<false | string>;
  end(): Promise<boolean>;
}

/**
 * Build the ssh2 connect options from our connection options. Credentials are
 * forwarded only when present so an empty string is never sent as a password.
 */
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
  };
}

/** Create an ssh2-sftp-client-backed {@link SftpClient}. */
export function createSsh2SftpClient(options: SftpConnectionOptions): SftpClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Ctor = require('ssh2-sftp-client') as new () => Ssh2ClientInstance;
  const client = new Ctor();
  return {
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
    async get(remotePath: string): Promise<Buffer> {
      return client.get(remotePath);
    },
    async put(data: Buffer, remotePath: string): Promise<void> {
      await client.put(data, remotePath);
    },
    async append(data: Buffer, remotePath: string): Promise<void> {
      await client.append(data, remotePath);
    },
    async delete(remotePath: string): Promise<void> {
      await client.delete(remotePath);
    },
    async rename(from: string, to: string): Promise<void> {
      await client.rename(from, to);
    },
    async mkdir(remoteDirectory: string): Promise<void> {
      const already = await client.exists(remoteDirectory);
      if (already === 'd') return;
      await client.mkdir(remoteDirectory, true);
    },
    async exists(remotePath: string): Promise<boolean> {
      return (await client.exists(remotePath)) !== false;
    },
    async end(): Promise<void> {
      await client.end();
    },
  };
}
