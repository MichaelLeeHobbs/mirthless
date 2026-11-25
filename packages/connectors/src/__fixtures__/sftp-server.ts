// An SFTP v3 server in this process, files in memory. It offers no extensions, so no
// posix-rename: the docker SFTP server (connector-sftp.itest.ts) is OpenSSH, which has it.

import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import type { SftpConnectionOptions } from '../sftp/sftp-client.js';

// ssh2 is the client library's own dependency, so it is resolved from there.
const ssh2 = createRequire(createRequire(import.meta.url).resolve('ssh2-sftp-client'))('ssh2') as Ssh2Module;

interface Ssh2Module {
  readonly Server: new (config: { hostKeys: string[] }, onClient: (client: ServerClient) => void) => SshServer;
  readonly utils: {
    generateKeyPairSync(type: 'ecdsa', options: { readonly bits: 256 }): { private: string; public: string };
    readonly sftp: { readonly STATUS_CODE: Readonly<Record<string, number>>; readonly OPEN_MODE: Readonly<Record<string, number>> };
  };
}

interface SshServer {
  listen(port: number, host: string, cb: () => void): void;
  address(): AddressInfo;
  close(cb: () => void): void;
}

interface ServerClient {
  on(event: string, handler: (...args: never[]) => void): ServerClient;
  end(): void;
}

interface ServerSession {
  on(event: 'sftp', handler: (accept: () => unknown, refuse: () => void) => void): void;
}

interface Attrs {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly size: number;
  readonly atime: number;
  readonly mtime: number;
}

interface SftpStream {
  on(event: string, handler: (reqId: number, ...args: never[]) => void): void;
  status(reqId: number, code: number, message?: string): void;
  handle(reqId: number, handle: Buffer): void;
  data(reqId: number, data: Buffer): void;
  attrs(reqId: number, attrs: Attrs): void;
  name(reqId: number, names: ReadonlyArray<{ filename: string; longname: string; attrs: Attrs }>): void;
}

const { STATUS_CODE, OPEN_MODE } = ssh2.utils.sftp;
const OK = STATUS_CODE['OK']!;
const EOF = STATUS_CODE['EOF']!;
const NO_SUCH_FILE = STATUS_CODE['NO_SUCH_FILE']!;
const FAILURE = STATUS_CODE['FAILURE']!;
const DENIED = STATUS_CODE['PERMISSION_DENIED']!;

export interface ServedFile {
  data: Buffer;
  /** Epoch seconds, all SFTP v3 carries. */
  mtime: number;
}

export interface SftpServerRules {
  /** A rename onto an existing name replaces it, as some servers do; otherwise it fails, as OpenSSH's does. */
  renameReplaces?: boolean;
  denyRename?: boolean;
  denyDelete?: boolean;
  /** Paths whose writes fail once this many bytes are in. */
  failWritesAfter?: { readonly matches: (filePath: string) => boolean; readonly bytes: number };
  /** Called with each write answered; the answer waits for it. */
  onWrite?: (filePath: string, size: number) => Promise<void> | void;
  /** Every rename is answered FAILURE, as by a server that allows none and does not say why. */
  failRename?: boolean;
  /** Takes a file away once it is closed after reading, as a pick-up folder does. */
  removeOnRead?: boolean;
  /** Opening a name that starts with a dot for writing is refused. */
  denyDotfiles?: boolean;
  /** Called before a rename is carried out. */
  onRename?: (from: string, to: string) => Promise<void> | void;
  /** Called when a signed-in client asks for the SFTP subsystem, which is then not started: refused, or left unanswered. */
  onSubsystem?: (refuse: () => void) => void;
}

export interface TestSftpServer {
  readonly options: SftpConnectionOptions & { readonly hostKey: string };
  readonly files: Map<string, ServedFile>;
  readonly rules: SftpServerRules;
  /** Names in a folder, as a partner listing it would see them. */
  list(dir: string): string[];
  text(filePath: string): string | undefined;
  /** Aged a minute unless told otherwise. */
  put(filePath: string, content: string, mtimeMs?: number): void;
  connections(): number;
  close(): Promise<void>;
}

interface OpenHandle {
  readonly filePath: string;
  readonly isDir: boolean;
  readonly append: boolean;
  readonly reads: boolean;
  listed: boolean;
}

class Server implements Omit<TestSftpServer, 'options' | 'connections' | 'close'> {
  readonly files = new Map<string, ServedFile>();
  readonly dirs = new Set<string>(['/']);
  readonly rules: SftpServerRules = {};
  private readonly handles = new Map<number, OpenHandle>();
  private nextHandle = 0;

  list(dir: string): string[] {
    return [...this.files.keys()].filter((p) => path.posix.dirname(p) === dir).map((p) => path.posix.basename(p));
  }

  text(filePath: string): string | undefined {
    return this.files.get(filePath)?.data.toString('utf8');
  }

  put(filePath: string, content: string, mtimeMs = Date.now() - 60_000): void {
    this.files.set(filePath, { data: Buffer.from(content, 'utf8'), mtime: Math.floor(mtimeMs / 1000) });
  }

  serve(stream: SftpStream): void {
    stream.on('OPEN', (id, filePath: string, flags: number) => { this.open(stream, id, filePath, flags); });
    stream.on('OPENDIR', (id, dir: string) => {
      if (!this.dirs.has(dir)) stream.status(id, NO_SUCH_FILE);
      else stream.handle(id, this.handleFor({ filePath: dir, isDir: true, append: false, reads: false, listed: false }));
    });
    stream.on('CLOSE', (id, handle: Buffer) => {
      const { filePath, reads } = this.handles.get(handle.readUInt32BE(0))!;
      if (reads && this.rules.removeOnRead) this.files.delete(filePath);
      stream.status(id, OK);
    });
    stream.on('READDIR', (id, handle: Buffer) => { this.readDir(stream, id, handle); });
    stream.on('READ', (id, handle: Buffer, offset: number, length: number) => {
      const file = this.files.get(this.handles.get(handle.readUInt32BE(0))!.filePath);
      const part = file?.data.subarray(offset, offset + length) ?? Buffer.alloc(0);
      if (part.length === 0) stream.status(id, EOF);
      else stream.data(id, part);
    });
    stream.on('WRITE', (id, handle: Buffer, offset: number, data: Buffer) => { void this.write(stream, id, handle, offset, data); });
    stream.on('FSTAT', (id, handle: Buffer) => { this.stat(stream, id, this.handles.get(handle.readUInt32BE(0))!.filePath); });
    for (const event of ['STAT', 'LSTAT']) {
      stream.on(event, (id, filePath: string) => { this.stat(stream, id, filePath); });
    }
    for (const event of ['SETSTAT', 'FSETSTAT']) stream.on(event, (id) => { stream.status(id, OK); });
    stream.on('REALPATH', (id, filePath: string) => {
      stream.name(id, [{ filename: path.posix.resolve('/', filePath), longname: '', attrs: this.dirAttrs() }]);
    });
    stream.on('MKDIR', (id, dir: string) => { this.dirs.add(dir); stream.status(id, OK); });
    stream.on('REMOVE', (id, filePath: string) => {
      if (this.rules.denyDelete) stream.status(id, DENIED);
      else stream.status(id, this.files.delete(filePath) ? OK : NO_SUCH_FILE);
    });
    stream.on('RENAME', (id, from: string, to: string) => { void this.rename(stream, id, from, to); });
  }

  private handleFor(handle: OpenHandle): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(this.nextHandle, 0);
    this.handles.set(this.nextHandle++, handle);
    return buffer;
  }

  private open(stream: SftpStream, id: number, filePath: string, flags: number): void {
    const exists = this.files.has(filePath);
    const truncates = (flags & OPEN_MODE['TRUNC']!) !== 0;
    const creates = (flags & OPEN_MODE['CREAT']!) !== 0;
    if (creates && this.rules.denyDotfiles && path.posix.basename(filePath).startsWith('.')) { stream.status(id, DENIED); return; }
    if (!exists && !creates) { stream.status(id, NO_SUCH_FILE); return; }
    if (!exists || truncates) this.put(filePath, '', Date.now());
    stream.handle(id, this.handleFor({ filePath, isDir: false, append: (flags & OPEN_MODE['APPEND']!) !== 0, reads: !creates, listed: false }));
  }

  private async write(stream: SftpStream, id: number, handle: Buffer, offset: number, data: Buffer): Promise<void> {
    const { filePath, append } = this.handles.get(handle.readUInt32BE(0))!;
    const { failWritesAfter, onWrite } = this.rules;
    const before = this.files.get(filePath)?.data ?? Buffer.alloc(0);
    const at = append ? before.length : offset;
    const limit = failWritesAfter?.matches(filePath) === true ? failWritesAfter.bytes : Infinity;
    if (at + data.length > limit) { stream.status(id, FAILURE, 'disk full'); return; }
    const after = Buffer.alloc(Math.max(before.length, at + data.length));
    before.copy(after);
    data.copy(after, at);
    if (this.files.has(filePath)) this.files.set(filePath, { data: after, mtime: Math.floor(Date.now() / 1000) });
    await onWrite?.(filePath, after.length);
    stream.status(id, OK);
  }

  private async rename(stream: SftpStream, id: number, from: string, to: string): Promise<void> {
    await this.rules.onRename?.(from, to);
    const file = this.files.get(from);
    if (this.rules.denyRename) stream.status(id, DENIED);
    else if (!file) stream.status(id, NO_SUCH_FILE);
    else if (this.rules.failRename || (this.files.has(to) && !this.rules.renameReplaces)) stream.status(id, FAILURE);
    else {
      this.files.delete(from);
      this.files.set(to, file);
      stream.status(id, OK);
    }
  }

  private readDir(stream: SftpStream, id: number, handle: Buffer): void {
    const open = this.handles.get(handle.readUInt32BE(0))!;
    if (open.listed) { stream.status(id, EOF); return; }
    open.listed = true;
    stream.name(id, this.list(open.filePath).map((filename) => {
      const attrs = this.fileAttrs(this.files.get(path.posix.join(open.filePath, filename))!);
      return { filename, longname: `-rw-r--r-- 1 u g ${String(attrs.size)} Jan 1 00:00 ${filename}`, attrs };
    }));
  }

  private stat(stream: SftpStream, id: number, filePath: string): void {
    const file = this.files.get(filePath);
    if (file) stream.attrs(id, this.fileAttrs(file));
    else if (this.dirs.has(filePath)) stream.attrs(id, this.dirAttrs());
    else stream.status(id, NO_SUCH_FILE);
  }

  private fileAttrs(file: ServedFile): Attrs {
    return { mode: 0o100644, uid: 0, gid: 0, size: file.data.length, atime: file.mtime, mtime: file.mtime };
  }

  private dirAttrs(): Attrs {
    return { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };
  }
}

export async function startSftpServer(...dirs: readonly string[]): Promise<TestSftpServer> {
  // Not ed25519: ssh2 cannot read some of the keys of that type it makes.
  const keys = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
  const server = new Server();
  for (const dir of dirs) server.dirs.add(dir);
  const clients = new Set<ServerClient>();
  const ssh = new ssh2.Server({ hostKeys: [keys.private] }, (client) => {
    clients.add(client);
    client.on('authentication', (ctx: { accept(): void }) => { ctx.accept(); });
    client.on('error', () => { /* A client that leaves mid-request is part of the tests. */ });
    client.on('close', () => { clients.delete(client); });
    client.on('session', (accept: () => ServerSession) => {
      accept().on('sftp', (acceptSftp, refuse) => {
        if (server.rules.onSubsystem) server.rules.onSubsystem(refuse);
        else server.serve(acceptSftp() as SftpStream);
      });
    });
  });
  await new Promise<void>((resolve) => { ssh.listen(0, '127.0.0.1', resolve); });
  return Object.assign(server, {
    options: {
      host: '127.0.0.1',
      port: ssh.address().port,
      username: 'lab',
      password: 'secret',
      strictHostKey: true,
      hostKey: keys.public.split(' ')[1]!,
    },
    connections: (): number => clients.size,
    close: async (): Promise<void> => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => { ssh.close(() => { resolve(); }); });
    },
  });
}
