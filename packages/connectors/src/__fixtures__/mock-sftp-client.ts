// One RemoteState can back several clients, so a test can restart against the same remote files.

import type { SftpClient, SftpFileInfo, SftpPathKind } from '../sftp/sftp-client.js';

const LEDGER_NAME = '.galvanigraph-quarantine.json';
/** Ledger names written under the product's earlier names (D-205, D-309). */
export const LEGACY_LEDGER_NAMES: readonly string[] = ['.galvaniflow-quarantine.json', '.mirthless-quarantine.json'];

export interface RemoteFile {
  size: number;
  modifyTime: number;
  content: string;
  /** Exact bytes to serve, for files that are not UTF-8. */
  bytes?: Buffer;
}

export interface MockFailures {
  connect?: boolean;
  list?: boolean;
  get?: boolean;
  put?: boolean;
  delete?: boolean;
  rename?: boolean;
  /** File names whose download fails while every other file works. */
  getNames?: readonly string[];
}

export class RemoteState {
  readonly files = new Map<string, RemoteFile>();
  ledger: string | null = null;
  readonly legacyLedgers = new Map<string, string>();
  readonly deleted: string[] = [];
  readonly renamed: Array<readonly [string, string]> = [];
  readonly mkdirs: string[] = [];
  connectCount = 0;
  endCount = 0;

  addFile(name: string, content: string, modifyTime: number): void {
    this.files.set(name, { size: content.length, modifyTime, content });
  }
}

function basename(remotePath: string): string {
  return remotePath.split('/').pop() ?? remotePath;
}

export function makeMockSftpClient(state: RemoteState, failures: MockFailures = {}): SftpClient {
  return {
    async connect(): Promise<void> {
      if (failures.connect) throw new Error('SFTP connect refused');
      state.connectCount++;
    },
    async list(): Promise<readonly SftpFileInfo[]> {
      if (failures.list) throw new Error('SFTP list failed');
      const result: SftpFileInfo[] = [];
      for (const [name, f] of state.files) {
        result.push({ name, size: f.size, modifyTime: f.modifyTime, isFile: true });
      }
      if (state.ledger !== null) {
        result.push({ name: LEDGER_NAME, size: state.ledger.length, modifyTime: 0, isFile: true });
      }
      for (const [name, text] of state.legacyLedgers) {
        result.push({ name, size: text.length, modifyTime: 0, isFile: true });
      }
      return result;
    },
    async get(remotePath: string): Promise<Buffer> {
      if (failures.get) throw new Error('SFTP get failed');
      const name = basename(remotePath);
      if (name === LEDGER_NAME) {
        if (state.ledger === null) throw new Error('no ledger');
        return Buffer.from(state.ledger, 'utf8');
      }
      if (LEGACY_LEDGER_NAMES.includes(name)) {
        const text = state.legacyLedgers.get(name);
        if (text === undefined) throw new Error('no legacy ledger');
        return Buffer.from(text, 'utf8');
      }
      const f = state.files.get(name);
      if (!f) throw new Error(`no such file: ${name}`);
      if (failures.getNames?.includes(name)) throw new Error(`SFTP get failed: ${name}`);
      return f.bytes ?? Buffer.from(f.content, 'utf8');
    },
    async put(data: Buffer, remotePath: string): Promise<void> {
      if (failures.put) throw new Error('SFTP put failed');
      const name = basename(remotePath);
      if (name === LEDGER_NAME) {
        state.ledger = data.toString('utf8');
        return;
      }
      if (LEGACY_LEDGER_NAMES.includes(name)) {
        state.legacyLedgers.set(name, data.toString('utf8'));
        return;
      }
      state.files.set(name, { size: data.length, modifyTime: Date.now(), content: data.toString('utf8') });
    },
    async append(data: Buffer, remotePath: string): Promise<void> {
      if (failures.put) throw new Error('SFTP append failed');
      const name = basename(remotePath);
      const existing = state.files.get(name);
      const content = (existing?.content ?? '') + data.toString('utf8');
      state.files.set(name, { size: content.length, modifyTime: Date.now(), content });
    },
    async delete(remotePath: string): Promise<void> {
      if (failures.delete) throw new Error('SFTP delete failed');
      const name = basename(remotePath);
      state.files.delete(name);
      state.deleted.push(name);
    },
    async rename(from: string, to: string): Promise<void> {
      if (failures.rename) throw new Error('SFTP rename failed');
      state.files.delete(basename(from));
      state.renamed.push([from, to]);
    },
    async mkdir(remoteDirectory: string): Promise<void> {
      state.mkdirs.push(remoteDirectory);
    },
    async pathKind(remotePath: string): Promise<SftpPathKind> {
      const name = basename(remotePath);
      if (name === LEDGER_NAME) return state.ledger !== null ? 'file' : 'missing';
      if (LEGACY_LEDGER_NAMES.includes(name)) return state.legacyLedgers.has(name) ? 'file' : 'missing';
      return state.files.has(name) ? 'file' : 'missing';
    },
    async end(): Promise<void> {
      state.endCount++;
    },
  };
}
