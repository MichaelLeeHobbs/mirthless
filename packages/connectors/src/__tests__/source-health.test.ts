// Every source that polls, or that keeps a connection to a partner, says when that fails and when it works again (#417).

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Result } from '@galvanigraph/core-util';
import { SOURCE_CONNECTOR_TYPES, type SourceConnectorType } from '@galvanigraph/core-models';
import type { DispatchResult, SourceConnectorRuntime } from '../base.js';
import { AmqpReceiver } from '../amqp/amqp-receiver.js';
import { DatabaseReceiver, UPDATE_MODE, ROW_FORMAT } from '../database/database-receiver.js';
import type { DatabasePool } from '../database/connection-pool.js';
import { DicomReceiver, DICOM_DISPATCH_MODE, DICOM_POST_ACTION, type DcmtkReceiver } from '../dicom/dicom-receiver.js';
import { EmailReceiver, EMAIL_POST_ACTION, EMAIL_PROTOCOL } from '../email/email-receiver.js';
import type { ImapClient } from '../email/imap-client.js';
import { FileReceiver, FILE_POST_ACTION, FILE_SORT_BY } from '../file/file-receiver.js';
import { JavaScriptReceiver } from '../javascript/javascript-receiver.js';
import { KafkaReceiver } from '../kafka/kafka-receiver.js';
import { SftpReceiver, SFTP_POST_ACTION } from '../sftp/sftp-receiver.js';
import { FakeAmqpQueue } from '../__fixtures__/fake-amqp.js';
import { FakeKafkaTopic } from '../__fixtures__/fake-kafka.js';
import { makeMockLogger } from '../__fixtures__/mock-logger.js';
import { makeMockSftpClient, RemoteState, type MockFailures } from '../__fixtures__/mock-sftp-client.js';
import type { SftpClient } from '../sftp/sftp-client.js';

/** A source whose partner a test takes away and gives back. */
interface Partner {
  readonly source: SourceConnectorRuntime;
  down(): void | Promise<void>;
  up(): void | Promise<void>;
  /** Makes the polls that come now wait, where the partner is a fake; the result makes them fail. */
  hold?(): () => void;
  /** In the text of the failure. */
  readonly reason: string;
}

/** Held polls. */
class Gate {
  private held: Promise<void> = Promise.resolve();

  hold(): () => void {
    let fail: () => void = () => undefined;
    this.held = new Promise((_resolve, reject) => { fail = (): void => { reject(new Error('a held poll failed')); }; });
    this.held.catch(() => undefined);
    return () => {
      fail();
      this.held = Promise.resolve();
    };
  }

  passed(): Promise<void> {
    return this.held;
  }
}

const OK = { ok: true, value: undefined, error: null } as const;
const { logger } = makeMockLogger();
const folders: string[] = [];

async function folder(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-'));
  folders.push(dir);
  return path.join(dir, 'in');
}

const anywhereTemporary = { allowed: [os.tmpdir()], denied: [] };

function failed(message: string): Result<never> {
  return { ok: false, value: null, error: new Error(message) } as unknown as Result<never>;
}

async function file(): Promise<Partner> {
  const directory = await folder();
  const source = new FileReceiver({
    directory, fileFilter: '*', pollingIntervalMs: 100, sortBy: FILE_SORT_BY.NAME, charset: 'utf-8', binary: false, checkFileAge: false,
    fileAgeMs: 0, ignoreDot: true, postAction: FILE_POST_ACTION.DELETE, moveToDirectory: '', roots: anywhereTemporary,
  }, logger);
  return { source, reason: 'ENOENT', up: async () => { await fs.mkdir(directory); }, down: async () => { await fs.rm(directory, { recursive: true, force: true }); } };
}

function sftp(): Partner {
  const failures: MockFailures = {};
  const gate = new Gate();
  const state = new RemoteState();
  const client = (): SftpClient => {
    const mock = makeMockSftpClient(state, failures);
    return { ...mock, list: async (dir) => { await gate.passed(); return mock.list(dir); } };
  };
  const source = new SftpReceiver({
    host: 'sftp.test', port: 22, strictHostKey: false, username: 'u', password: 'p', remoteDirectory: '/in', filePattern: '*', pollingIntervalMs: 100,
    ignoreDot: true, minFileAgeMs: 0, afterProcessing: SFTP_POST_ACTION.NONE, moveToDirectory: '',
  }, client, logger);
  return { source, reason: 'SFTP list failed', down: () => { failures.list = true; }, up: () => { failures.list = false; }, hold: () => gate.hold() };
}

function email(): Partner {
  let down = false;
  const gate = new Gate();
  const client: ImapClient = {
    connect: async () => undefined, markRead: async () => undefined, mark: async () => true, destroy: () => undefined, moveMessage: async () => undefined,
    deleteMessage: async () => undefined, disconnect: async () => undefined,
    fetchUnread: async () => { await gate.passed(); if (down) throw new Error('IMAP gone'); return { uidValidity: '1', emails: [], unreadable: [] }; },
  };
  const source = new EmailReceiver({
    host: 'mail.test', port: 993, secure: true, username: 'u', password: 'p', protocol: EMAIL_PROTOCOL.IMAP, folder: 'INBOX',
    pollingIntervalMs: 1_000, postAction: EMAIL_POST_ACTION.MARK_READ, moveToFolder: '', subjectFilter: '',
  }, () => client, logger);
  return { source, reason: 'IMAP gone', down: () => { down = true; }, up: () => { down = false; }, hold: () => gate.hold() };
}

function database(updateMode: typeof UPDATE_MODE[keyof typeof UPDATE_MODE]): Partner {
  let down = false;
  const gate = new Gate();
  const rows = async (): Promise<Result<never>> => {
    if (down || !(await gate.passed().then(() => true, () => false))) return failed('database gone');
    return { ok: true, value: { rows: [], rowCount: 0 }, error: null } as never;
  };
  const pool = { create: async () => OK, destroy: async () => OK, query: rows, queryReadOnly: rows, transaction: rows } as unknown as DatabasePool;
  const source = new DatabaseReceiver({
    host: 'db.test', port: 5432, database: 'd', username: 'u', password: 'p', selectQuery: 'SELECT 1', updateQuery: 'UPDATE t', updateMode,
    pollingIntervalMs: 100, rowFormat: ROW_FORMAT.JSON,
  }, pool, logger);
  return { source, reason: 'database gone', down: () => { down = true; }, up: () => { down = false; }, hold: () => gate.hold() };
}

function javascript(): Partner {
  let down = false;
  const gate = new Gate();
  const source = new JavaScriptReceiver({ script: 'return [];', pollingIntervalMs: 100 }, logger);
  source.setScriptRunner(async () => {
    if (down || !(await gate.passed().then(() => true, () => false))) return failed('vault sealed');
    return { ok: true, value: [], error: null };
  });
  return { source, reason: 'vault sealed', down: () => { down = true; }, up: () => { down = false; }, hold: () => gate.hold() };
}

function kafka(): Partner {
  const topic = new FakeKafkaTopic();
  const source = new KafkaReceiver({ brokers: 'b:9092', topic: 't', groupId: 'g', startFrom: 'EARLIEST', clientId: '', saslMechanism: 'NONE', saslUsername: '', saslPassword: '' }, topic.subscribe, logger, 10);
  return { source, reason: 'broker', down: () => { topic.failSubscribes = Infinity; topic.disconnect(); }, up: () => { topic.failSubscribes = 0; } };
}

function amqp(): Partner {
  const queue = new FakeAmqpQueue();
  const source = new AmqpReceiver({ host: 'mq.test', port: 5672, vhost: '/', username: '', password: '', queue: 'q' }, queue.consume, logger, 10);
  return { source, reason: 'broker', down: () => { queue.failConnects = Infinity; queue.disconnect(); }, up: () => { queue.failConnects = 0; } };
}

async function dicom(): Promise<Partner> {
  const storageDir = await folder();
  const receiver = { onEvent: () => undefined, onFileReceived: () => undefined, onAssociationComplete: () => undefined, start: async () => OK, stop: async () => OK } as unknown as DcmtkReceiver;
  const source = new DicomReceiver({
    port: 11112, storageDir, aeTitle: 'TEST', connectionTimeoutMs: 1_000, dispatchMode: DICOM_DISPATCH_MODE.PER_ASSOCIATION,
    postAction: DICOM_POST_ACTION.NONE, moveToDirectory: '', channelId: 'c1', roots: anywhereTemporary,
  }, () => ({ ok: true, value: receiver, error: null }), 50);
  // A missing folder is an empty list; a file in its place cannot be listed.
  const lists = path.join(storageDir, '.galvanigraph-pending', 'c1');
  return {
    source, reason: 'ENOTDIR', up: async () => { await fs.rm(lists, { force: true }); },
    down: async () => { await fs.mkdir(path.dirname(lists), { recursive: true }); await fs.writeFile(lists, ''); },
  };
}

const PARTNERS: Readonly<Partial<Record<SourceConnectorType, ReadonlyArray<readonly [string, () => Partner | Promise<Partner>]>>>> = {
  FILE: [['FILE', file]],
  SFTP: [['SFTP', sftp]],
  EMAIL: [['EMAIL', email]],
  DATABASE: [['DATABASE, without marking rows', () => database(UPDATE_MODE.NEVER)], ['DATABASE, marking rows', () => database(UPDATE_MODE.ALWAYS)]],
  JAVASCRIPT: [['JAVASCRIPT', javascript]],
  KAFKA: [['KAFKA', kafka]],
  AMQP: [['AMQP', amqp]],
  DICOM: [['DICOM', dicom]],
};

/** Their partners connect to them, so there is nothing to poll or lose: a silent one is for a NO_MESSAGES alert. */
const LISTENERS: readonly SourceConnectorType[] = ['TCP_MLLP', 'HTTP', 'CHANNEL'];

const dispatcher = async (): Promise<Result<DispatchResult>> => ({ ok: true, value: { messageId: 1 }, error: null });

/** Generous, so a loaded machine cannot fail a wait that would succeed. */
const WAIT = { timeout: 10_000, interval: 10 };

async function started(make: () => Partner | Promise<Partner>): Promise<Partner & { readonly seen: Array<Error | null> }> {
  const partner = await make();
  const seen: Array<Error | null> = [];
  await partner.up();
  partner.source.setDispatcher(dispatcher);
  partner.source.setHealthHandler?.((failure) => { seen.push(failure); });
  expect(await partner.source.onStart()).toMatchObject({ ok: true });
  return { ...partner, seen };
}

/** Once nothing has been reported for as long as two polls of any of these sources but EMAIL take. */
async function settled(seen: readonly unknown[]): Promise<number> {
  let last = -1;
  while (last !== seen.length) {
    last = seen.length;
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  return last;
}

afterEach(async () => {
  for (const dir of folders.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

it('covers every source type', () => {
  expect([...Object.keys(PARTNERS), ...LISTENERS].sort()).toEqual([...SOURCE_CONNECTOR_TYPES].sort());
});

describe.each(Object.values(PARTNERS).flat())('a %s source', (_name, make) => {
  it('says that its partner is gone, at each attempt, and that it is back', async () => {
    const { source, seen, down, up, reason } = await started(make);

    await down();
    await vi.waitFor(() => { expect(seen.filter((failure) => failure !== null).length).toBeGreaterThanOrEqual(2); }, WAIT);
    expect(seen.find((failure) => failure !== null)?.message).toContain(reason);

    await up();
    await vi.waitFor(() => { expect(seen.at(-1)).toBeNull(); }, WAIT);
    await source.onStop();
  });

  it('says nothing of the connection it closes when it is stopped', async () => {
    const { source, seen } = await started(make);
    await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(0); }, WAIT);

    await source.onStop();

    expect(seen.filter((failure) => failure !== null)).toEqual([]);
  });
});

// The engine does not know of a pause: the run goes on, and only the source can tell.
const HELD = Object.values(PARTNERS).flat().filter(([name]) => !['FILE', 'KAFKA', 'AMQP', 'DICOM'].includes(name));

describe.each(HELD)('a %s source with a poll under way', (_name, make) => {
  /** Started, with a poll that waits. */
  async function polling(): Promise<Awaited<ReturnType<typeof started>> & { readonly fail: () => void }> {
    const partner = await started(make);
    await vi.waitFor(() => { expect(partner.seen.length).toBeGreaterThan(0); }, WAIT);
    const fail = partner.hold!();
    await settled(partner.seen);
    return { ...partner, fail };
  }

  it.each(['onStop', 'onHalt'] as const)('says nothing of that poll after %s', async (end) => {
    const { source, seen, fail } = await polling();
    const before = seen.length;

    const ending = source[end]();
    fail();
    await ending;
    await settled(seen);

    expect(seen.length).toBe(before);
  });

  it('says nothing of it after a halt and a start', async () => {
    const { source, seen, fail } = await polling();

    await source.onHalt();
    const starting = source.onStart();
    fail();
    await starting;
    const restarted = seen.length;
    await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(restarted + 1); }, WAIT);
    await source.onStop();

    expect(seen.filter((failure) => failure !== null)).toEqual([]);
  });
});

describe('an EMAIL source whose server closed the connection it kept', () => {
  it('reads the folder on a new connection at the same poll, and says nothing', async () => {
    let connections = 0;
    const seen: Array<Error | null> = [];
    const source = new EmailReceiver({
      host: 'mail.test', port: 993, secure: true, username: 'u', password: 'p', protocol: EMAIL_PROTOCOL.IMAP, folder: 'INBOX',
      pollingIntervalMs: 1_000, postAction: EMAIL_POST_ACTION.MARK_READ, moveToFolder: '', subjectFilter: '',
    }, () => {
      connections += 1;
      let reads = 0;
      // Each connection is closed by the server after its first reading.
      return {
        connect: async () => undefined, markRead: async () => undefined, mark: async () => true, moveMessage: async () => undefined,
        deleteMessage: async () => undefined, disconnect: async () => undefined, destroy: () => undefined,
        fetchUnread: async () => { reads += 1; if (reads > 1) throw new Error('connection closed'); return { uidValidity: '1', emails: [], unreadable: [] }; },
      };
    }, logger);
    source.setDispatcher(dispatcher);
    source.setHealthHandler((failure) => { seen.push(failure); });
    await source.onStart();

    await vi.waitFor(() => { expect(connections).toBeGreaterThanOrEqual(3); }, WAIT);
    await source.onStop();

    expect(seen.filter((failure) => failure !== null)).toEqual([]);
  });
});

describe('a SFTP source whose server closed the connection it kept', () => {
  it('reads the directory on a new connection at the same poll, and says nothing', async () => {
    const state = new RemoteState();
    let connections = 0;
    const seen: Array<Error | null> = [];
    const source = new SftpReceiver({
      host: 'sftp.test', port: 22, strictHostKey: false, username: 'u', password: 'p', remoteDirectory: '/in', filePattern: '*', pollingIntervalMs: 100,
      ignoreDot: true, minFileAgeMs: 0, afterProcessing: SFTP_POST_ACTION.NONE, moveToDirectory: '',
    }, () => {
      const mine = ++connections;
      const mock = makeMockSftpClient(state, {});
      let lists = 0;
      // Each connection is closed by the server after its second listing.
      return { ...mock, list: async (dir) => { lists += 1; if (lists > 2) throw new Error(`connection ${String(mine)} closed`); return mock.list(dir); } };
    }, logger);
    source.setDispatcher(dispatcher);
    source.setHealthHandler((failure) => { seen.push(failure); });
    await source.onStart();

    await vi.waitFor(() => { expect(connections).toBeGreaterThanOrEqual(3); }, WAIT);
    await source.onStop();

    expect(seen.filter((failure) => failure !== null)).toEqual([]);
  });
});

describe('a DATABASE source', () => {
  it('says what the database refused by its code: its text can quote a value of a row', async () => {
    const refused = { ok: false, value: null, error: Object.assign(new Error('invalid input syntax for type date: "DOE^JANE"'), { code: '22007' }) };
    const pool = { create: async () => OK, destroy: async () => OK, query: async () => refused } as unknown as DatabasePool;
    const seen: Array<Error | null> = [];
    const source = new DatabaseReceiver({
      host: 'db.test', port: 5432, database: 'd', username: 'u', password: 'p', selectQuery: 'SELECT 1', updateQuery: '', updateMode: UPDATE_MODE.NEVER,
      pollingIntervalMs: 100, rowFormat: ROW_FORMAT.JSON,
    }, pool, logger);
    source.setDispatcher(dispatcher);
    source.setHealthHandler((failure) => { seen.push(failure); });

    await source.onStart();
    await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(0); }, WAIT);
    await source.onStop();

    expect(seen[0]?.message).toBe('The database answered 22007; the server log has its text');
  });
});
