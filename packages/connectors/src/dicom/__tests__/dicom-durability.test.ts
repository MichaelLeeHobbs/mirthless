// An image answered with success has a message, or a durable way to make one (#410): real
// associations with the listener, and a pipeline that stores, fails or is cut off as told.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import pkg from 'dcmjs-dimse';
import { stderr, type Result } from '@galvanigraph/core-util';
import type { DispatchResult, MessageDispatcher, RawMessage } from '../../base.js';
import { DicomReceiver, type DicomReceiverConfig } from '../dicom-receiver.js';
import { freePort } from '../../__fixtures__/free-port.js';

/** What fails, as a full disk or a locked file makes it fail. */
const broken = vi.hoisted(() => ({ sync: false, remove: false }));
vi.mock('../durable-file.js', async (importActual) => {
  const actual = await importActual<typeof import('../durable-file.js')>();
  return {
    ...actual,
    syncFile: (file: string) => (broken.sync && file.endsWith('.jsonl') ? Promise.reject(Object.assign(new Error('no space'), { code: 'ENOSPC' })) : actual.syncFile(file)),
  };
});
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: (target: string, options?: object) => (broken.remove && target.endsWith('.jsonl')
      ? Promise.reject(Object.assign(new Error('locked'), { code: 'EPERM' })) : actual.rm(target, options)),
  };
});

const { Client, Dataset, constants, requests } = pkg;
const { CStoreRequest } = requests;
const { AbortReason, AbortSource, Status, StorageClass, TransferSyntax } = constants;
type CStoreResponseType = InstanceType<typeof pkg.responses.CStoreResponse>;

const CHANNEL = 'channel-1';
const SWEEP_MS = 100;
const PROCESSED: Result<DispatchResult> = { ok: true, value: { messageId: 1, status: 'PROCESSED' }, error: null };
const RECOVERABLE = { recoverable: true };
const STORE_DOWN: Result<DispatchResult> = { ok: false, value: null, error: stderr('the store is down') };

let storageDir: string;
let port: number;
const listeners: DicomReceiver[] = [];

beforeEach(async () => {
  broken.sync = false;
  broken.remove = false;
  storageDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-durable-')));
  port = await freePort();
});

afterEach(async () => {
  broken.remove = false;
  for (const listener of listeners.splice(0)) {
    await listener.onStop();
    await listener.onUndeploy();
  }
  await fs.rm(storageDir, { recursive: true, force: true });
});

/** The default wait is one second, which a busy host exceeds. */
const waitFor = <T>(check: () => T | Promise<T>): Promise<T> => vi.waitFor(check, 15_000);

type Pipeline = (raw: RawMessage) => Promise<Result<DispatchResult>>;

async function listen(pipeline: Pipeline, overrides: Partial<DicomReceiverConfig> = {}, Receiver = DicomReceiver): Promise<DicomReceiver> {
  const listener = new Receiver({
    port,
    storageDir,
    aeTitle: 'LISTENER',
    connectionTimeoutMs: 10_000,
    dispatchMode: 'PER_FILE',
    postAction: 'NONE',
    moveToDirectory: '',
    channelId: CHANNEL,
    roots: { allowed: [storageDir], denied: [] },
    ...overrides,
  }, undefined, SWEEP_MS);
  listener.setDispatcher(pipeline as MessageDispatcher);
  const started = await listener.onStart();
  if (!started.ok) throw started.error;
  listeners.push(listener);
  return listener;
}

type Ending = 'release' | 'abort' | 'hang-up' | 'stay-open';

/** Store these instances on one association; their statuses. Ends it as told after the last answer. */
function store(uids: readonly string[], ending: Ending = 'release'): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const statuses: number[] = [];
    const client = new Client();
    uids.forEach((uid, i) => {
      const dataset = new Dataset({ SOPClassUID: StorageClass.CtImageStorage, SOPInstanceUID: uid, PatientName: 'TEST^PATIENT' }, TransferSyntax.ImplicitVRLittleEndian);
      const request = new CStoreRequest(dataset);
      request.on('response', (response: CStoreResponseType) => {
        statuses.push(response.getStatus());
        if (i < uids.length - 1 || ending === 'release' || ending === 'stay-open') return;
        if (ending === 'abort') client.abort(AbortSource.ServiceUser, AbortReason.NotSpecified);
        else (client as unknown as { network: { socket: { destroy(): void } } }).network.socket.destroy();
      });
      client.addRequest(request);
    });
    client.on('networkError', reject);
    client.on('closed', () => { resolve(statuses); });
    // Keeps the association open after the last answer, so the ending is the test's.
    client.send('127.0.0.1', port, 'SCANNER', 'LISTENER', {
      connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000, associationLingerTimeout: ending === 'release' ? 0 : 10_000,
    });
  });
}

/** The received images, by name. */
async function images(): Promise<string[]> {
  return (await fs.readdir(storageDir)).filter((name) => name.endsWith('.dcm')).sort();
}

function pendingDir(channelId = CHANNEL): string {
  return path.join(storageDir, '.galvanigraph-pending', channelId);
}

async function lists(channelId = CHANNEL): Promise<string[]> {
  return fs.readdir(pendingDir(channelId)).catch(() => []);
}

/** What the process knew is gone; what is on disk is not. */
async function restarted(): Promise<typeof DicomReceiver> {
  vi.resetModules();
  return (await import('../dicom-receiver.js')).DicomReceiver;
}

function filesOf(raw: RawMessage): string[] {
  return (JSON.parse(raw.content) as string[]).map((file) => path.basename(file));
}

describe('PER_FILE', () => {
  it('answers success once the message is stored, without waiting for the pipeline to end', async () => {
    const seen: RawMessage[] = [];
    let end = (): void => undefined;
    await listen(async (raw) => {
      seen.push(raw);
      raw.onStored?.(RECOVERABLE);
      await new Promise<void>((resolve) => { end = resolve; });
      return PROCESSED;
    });

    expect(await store(['1.2.3'])).toEqual([Status.Success]);

    expect(seen.map((raw) => raw.content)).toEqual([path.join(storageDir, '1.2.3.dcm')]);
    expect(await images()).toEqual(['1.2.3.dcm']);
    end();
  });

  it('answers nothing until the message is stored', async () => {
    const order: string[] = [];
    await listen(async (raw) => {
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      order.push('stored');
      raw.onStored?.(RECOVERABLE);
      return PROCESSED;
    });

    const statuses = await store(['1.2.3']).then((s) => { order.push('answered'); return s; });

    expect(statuses).toEqual([Status.Success]);
    expect(order).toEqual(['stored', 'answered']);
  });

  it('answers success for a pipeline that does not say when it stored, once it ends', async () => {
    await listen(async () => PROCESSED);
    expect(await store(['1.2.3'])).toEqual([Status.Success]);
  });

  it.each<[string, Pipeline]>([
    ['reports that it could not store the message', async () => STORE_DOWN],
    ['throws', async () => { throw new Error('pipeline broke'); }],
  ])('answers a failure, and keeps no file the sender still has, when the pipeline %s', async (_case, pipeline) => {
    await listen(pipeline);

    expect(await store(['1.2.3'])).toEqual([Status.ProcessingFailure]);

    expect(await images()).toEqual([]);
  });

  it('stores the image when the sender sends it again after a failure', async () => {
    const results = [STORE_DOWN, PROCESSED];
    const dispatched = vi.fn(async () => results.shift() ?? PROCESSED);
    await listen(dispatched);

    expect(await store(['1.2.3'])).toEqual([Status.ProcessingFailure]);
    expect(await store(['1.2.3'])).toEqual([Status.Success]);

    expect(dispatched).toHaveBeenCalledTimes(2);
    expect(await images()).toEqual(['1.2.3.dcm']);
  });

  it('keeps the file of a message that failed after it was stored', async () => {
    await listen(async (raw) => {
      raw.onStored?.(RECOVERABLE);
      return { ok: true, value: { messageId: 1, status: 'ERROR' }, error: null };
    }, { postAction: 'DELETE' });

    expect(await store(['1.2.3'])).toEqual([Status.Success]);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(await images()).toEqual(['1.2.3.dcm']);
  });
});

describe('PER_ASSOCIATION', () => {
  const PER_ASSOCIATION = { dispatchMode: 'PER_ASSOCIATION' } as const;

  it.each<[string, Ending]>([
    ['released', 'release'],
    ['aborted', 'abort'],
    ['cut off', 'hang-up'],
  ])('makes one message of the answered images of an association that was %s', async (_case, ending) => {
    const seen: RawMessage[] = [];
    await listen(async (raw) => { seen.push(raw); raw.onStored?.(RECOVERABLE); return PROCESSED; }, PER_ASSOCIATION);

    expect(await store(['1.2.1', '1.2.2'], ending)).toEqual([Status.Success, Status.Success]);

    await waitFor(() => { expect(seen).toHaveLength(1); });
    expect(filesOf(seen[0]!)).toEqual(['1.2.1.dcm', '1.2.2.dcm']);
    expect(seen[0]!.sourceMap).toMatchObject({ callingAE: 'SCANNER', calledAE: 'LISTENER', fileCount: 2 });
    await waitFor(async () => { expect(await lists()).toEqual([]); });
    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(seen).toHaveLength(1);
  });

  it('makes no message of an association whose images were all refused, and leaves no list', async () => {
    await fs.writeFile(path.join(storageDir, '.galvanigraph-pending'), 'in the way');
    const pipeline = vi.fn(async () => PROCESSED);
    await listen(pipeline, PER_ASSOCIATION);

    expect(await store(['1.2.1'])).toEqual([Status.ProcessingFailure]);

    expect(await images()).toEqual([]);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('makes no message of a connection that stored nothing and did not release', async () => {
    const pipeline = vi.fn(async () => PROCESSED);
    await listen(pipeline, PER_ASSOCIATION);

    const socket = (await import('node:net')).connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => { socket.once('connect', () => { socket.destroy(); resolve(); }); });

    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('has the images on the list before it answers', async () => {
    await listen(async () => PROCESSED, PER_ASSOCIATION);
    const answered: string[] = [];
    const client = new Client();
    const request = new CStoreRequest(new Dataset({ SOPClassUID: StorageClass.CtImageStorage, SOPInstanceUID: '1.2.3' }, TransferSyntax.ImplicitVRLittleEndian));
    await new Promise<void>((resolve) => {
      request.on('response', () => {
        const [name] = fsSync.readdirSync(pendingDir());
        answered.push(...fsSync.readFileSync(path.join(pendingDir(), name ?? ''), 'utf8').trim().split('\n'));
      });
      client.addRequest(request);
      client.on('closed', () => { resolve(); });
      client.send('127.0.0.1', port, 'SCANNER', 'LISTENER', { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000, associationLingerTimeout: 500 });
    });

    expect(answered.map((line) => JSON.parse(line) as unknown)).toEqual([{ file: '1.2.3.dcm', callingAE: 'SCANNER', calledAE: 'LISTENER' }]);
  });

  it('makes the message later when the store was down, once', async () => {
    const seen: RawMessage[] = [];
    const results = [STORE_DOWN, STORE_DOWN, PROCESSED];
    await listen(async (raw) => { seen.push(raw); return results.shift() ?? PROCESSED; }, { ...PER_ASSOCIATION, postAction: 'DELETE' });

    expect(await store(['1.2.1'])).toEqual([Status.Success]);

    await waitFor(() => { expect(seen).toHaveLength(3); });
    expect(filesOf(seen[2]!)).toEqual(['1.2.1.dcm']);
    await waitFor(async () => { expect(await images()).toEqual([]); });
    expect(await lists()).toEqual([]);
    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(seen).toHaveLength(3);
  });

  it('makes the message after a crash before it was stored', async () => {
    // Never stored and never answered: the process is gone in the middle of it.
    const crashed = await listen(() => new Promise(() => undefined), PER_ASSOCIATION);
    expect(await store(['1.2.1', '1.2.2'], 'abort')).toEqual([Status.Success, Status.Success]);
    await waitFor(async () => { expect(await lists()).toHaveLength(1); });
    await crashed.onStop();

    const seen: RawMessage[] = [];
    await listen(async (raw) => { seen.push(raw); raw.onStored?.(RECOVERABLE); return PROCESSED; }, PER_ASSOCIATION, await restarted());

    await waitFor(() => { expect(seen).toHaveLength(1); });
    expect(filesOf(seen[0]!)).toEqual(['1.2.1.dcm', '1.2.2.dcm']);
    expect(seen[0]!.sourceMap).toMatchObject({ callingAE: 'SCANNER', calledAE: 'LISTENER', fileCount: 2 });
  });

  it('makes no second message after a crash while the stored one was being processed', async () => {
    const crashed = await listen((raw) => { raw.onStored?.(RECOVERABLE); return new Promise(() => undefined); }, PER_ASSOCIATION);
    expect(await store(['1.2.1'])).toEqual([Status.Success]);
    await waitFor(async () => { expect(await lists()).toEqual([]); });
    await crashed.onStop();

    const pipeline = vi.fn(async () => PROCESSED);
    await listen(pipeline, PER_ASSOCIATION, await restarted());

    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(pipeline).not.toHaveBeenCalled();
    expect(await images()).toEqual(['1.2.1.dcm']);
  });

  it('leaves an association a stop interrupted to the next start', async () => {
    const seen: RawMessage[] = [];
    const pipeline: Pipeline = async (raw) => { seen.push(raw); raw.onStored?.(RECOVERABLE); return PROCESSED; };
    const listener = await listen(pipeline, PER_ASSOCIATION);
    // The stop resets the connection.
    const sent = store(['1.2.1'], 'stay-open').catch(() => []);
    await waitFor(async () => { expect(await lists()).toHaveLength(1); });
    await listener.onStop();
    await sent;
    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(seen).toEqual([]);
    expect(await lists()).toHaveLength(1);

    await listener.onStart();

    await waitFor(() => { expect(seen).toHaveLength(1); });
  });

  it('does not touch the lists of another channel that stores in the same directory', async () => {
    await fs.mkdir(pendingDir('channel-2'), { recursive: true });
    await fs.writeFile(path.join(pendingDir('channel-2'), 'assoc-x.jsonl'), '\n{"file":"9.dcm","callingAE":"A","calledAE":"B"}');
    const pipeline = vi.fn(async () => PROCESSED);
    await listen(pipeline, PER_ASSOCIATION);

    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(pipeline).not.toHaveBeenCalled();
    expect(await lists('channel-2')).toEqual(['assoc-x.jsonl']);
  });

  describe('an image refused because the list could not be synced', () => {
    // The line may be on the list all the same, and a list's files are its message's: a name that
    // went to the image sent again would be deleted by whichever message is done first.
    it('keeps its file, so the image sent again gets another', async () => {
      const seen: RawMessage[] = [];
      await listen(async (raw) => { seen.push(raw); raw.onStored?.(RECOVERABLE); return PROCESSED; }, PER_ASSOCIATION);

      broken.sync = true;
      expect(await store(['1.2.1'])).toEqual([Status.ProcessingFailure]);
      broken.sync = false;
      expect(await store(['1.2.1'])).toEqual([Status.Success]);

      await waitFor(() => { expect(seen).toHaveLength(1); });
      expect(filesOf(seen[0]!)).toEqual(['1.2.1_2.dcm']);
      expect(await images()).toEqual(['1.2.1.dcm', '1.2.1_2.dcm']);
    });

    it('leaves no list when nothing else was stored, so a restart makes no message of it', async () => {
      const first = await listen(async () => PROCESSED, PER_ASSOCIATION);
      broken.sync = true;
      expect(await store(['1.2.1'], 'abort')).toEqual([Status.ProcessingFailure]);
      broken.sync = false;
      await waitFor(async () => { expect(await lists()).toEqual([]); });
      await first.onStop();

      const pipeline = vi.fn(async () => PROCESSED);
      await listen(pipeline, PER_ASSOCIATION, await restarted());
      await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
      expect(pipeline).not.toHaveBeenCalled();
    });
  });

  it('keeps the list until the pipeline ends when a restart could not run the message again', async () => {
    let end = (): void => undefined;
    let told = false;
    await listen(async (raw) => {
      raw.onStored?.({ recoverable: false });
      told = true;
      await new Promise<void>((resolve) => { end = resolve; });
      return PROCESSED;
    }, PER_ASSOCIATION);

    expect(await store(['1.2.1'])).toEqual([Status.Success]);
    await waitFor(() => { expect(told).toBe(true); });
    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
    expect(await lists()).toHaveLength(1);

    end();
    await waitFor(async () => { expect(await lists()).toEqual([]); });
  });

  it('makes the message again when one that a restart could not run was cut short', async () => {
    const seen: RawMessage[] = [];
    await listen(async (raw) => {
      seen.push(raw);
      raw.onStored?.({ recoverable: false });
      return seen.length === 1 ? STORE_DOWN : PROCESSED;
    }, PER_ASSOCIATION);

    expect(await store(['1.2.1'])).toEqual([Status.Success]);

    await waitFor(() => { expect(seen).toHaveLength(2); });
    await waitFor(async () => { expect(await lists()).toEqual([]); });
  });

  it('makes one message, and keeps its files, while its list cannot be removed', async () => {
    broken.remove = true;
    const seen: RawMessage[] = [];
    await listen(async (raw) => { seen.push(raw); raw.onStored?.(RECOVERABLE); return PROCESSED; }, { ...PER_ASSOCIATION, postAction: 'DELETE' });

    expect(await store(['1.2.1'])).toEqual([Status.Success]);

    await waitFor(() => { expect(seen).toHaveLength(1); });
    await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 5); });
    expect(seen).toHaveLength(1);
    expect(await images()).toEqual(['1.2.1.dcm']);
  });

  describe('a list left on disk', () => {
    async function leftBehind(lines: readonly string[]): Promise<void> {
      await fs.mkdir(pendingDir(), { recursive: true });
      await fs.writeFile(path.join(pendingDir(), 'assoc-x.jsonl'), lines.map((line) => `\n${line}`).join(''));
    }
    const line = (file: string): string => JSON.stringify({ file, callingAE: 'A', calledAE: 'B' });

    it('gives the images it can: not one whose line was cut short, whose file is gone, or that is not directly in the storage directory', async () => {
      await fs.writeFile(path.join(storageDir, 'here.dcm'), 'DICM');
      await fs.mkdir(path.join(storageDir, 'sub'));
      await fs.writeFile(path.join(storageDir, 'sub', 'elsewhere.dcm'), 'DICM');
      await leftBehind([line('here.dcm'), line('gone.dcm'), line('sub/elsewhere.dcm'), line('../outside.dcm'), line('..'), '"text"', '{"file":1}', line('here.dcm'), '{"file":"cut']);
      const seen: RawMessage[] = [];
      await listen(async (raw) => { seen.push(raw); return PROCESSED; }, { ...PER_ASSOCIATION, postAction: 'DELETE' });

      await waitFor(() => { expect(seen).toHaveLength(1); });
      expect(filesOf(seen[0]!)).toEqual(['here.dcm']);
      await waitFor(async () => { expect(await lists()).toEqual([]); });
      expect(await fs.readdir(path.join(storageDir, 'sub'))).toEqual(['elsewhere.dcm']);
    });

    it('does not wait for one that cannot be read', async () => {
      await fs.mkdir(path.join(pendingDir(), 'assoc-a.jsonl'), { recursive: true });
      await fs.utimes(path.join(pendingDir(), 'assoc-a.jsonl'), new Date(0), new Date(0));
      await fs.writeFile(path.join(storageDir, 'here.dcm'), 'DICM');
      await leftBehind([line('here.dcm')]);
      const seen: RawMessage[] = [];
      await listen(async (raw) => { seen.push(raw); return PROCESSED; }, PER_ASSOCIATION);

      await waitFor(() => { expect(seen).toHaveLength(1); });
      expect(filesOf(seen[0]!)).toEqual(['here.dcm']);
      expect(await lists()).toContain('assoc-a.jsonl');
    });

    it('is dropped when every file is gone', async () => {
      await leftBehind([line('gone.dcm')]);
      const pipeline = vi.fn(async () => PROCESSED);
      await listen(pipeline, PER_ASSOCIATION);

      await waitFor(async () => { expect(await lists()).toEqual([]); });
      expect(pipeline).not.toHaveBeenCalled();
    });

    it('is taken by a listener that is PER_FILE now', async () => {
      await fs.writeFile(path.join(storageDir, 'here.dcm'), 'DICM');
      await leftBehind([line('here.dcm')]);
      const seen: RawMessage[] = [];
      await listen(async (raw) => { seen.push(raw); return PROCESSED; });

      await waitFor(() => { expect(seen).toHaveLength(1); });
      expect(filesOf(seen[0]!)).toEqual(['here.dcm']);
    });

    it('is not taken while another listener of the process has it', async () => {
      await fs.writeFile(path.join(storageDir, 'here.dcm'), 'DICM');
      await leftBehind([line('here.dcm')]);
      const first = vi.fn<Pipeline>(() => new Promise(() => undefined));
      const listener = await listen(first, PER_ASSOCIATION);
      await waitFor(() => { expect(first).toHaveBeenCalledTimes(1); });
      await listener.onStop();

      // A redeploy: a new listener, while the old one's pipeline has not stored the message yet.
      const second = vi.fn<Pipeline>(async () => PROCESSED);
      await listen(second, PER_ASSOCIATION);

      await new Promise((resolve) => { setTimeout(resolve, SWEEP_MS * 3); });
      expect(second).not.toHaveBeenCalled();
    });
  });
});
