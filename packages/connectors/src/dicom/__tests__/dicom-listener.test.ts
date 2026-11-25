// What the DICOM Listener takes, and how it starts and stops (#410), over real associations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import pkg from 'dcmjs-dimse';
import type { DispatchResult, MessageDispatcher, RawMessage } from '../../base.js';
import type { Result } from '@galvanigraph/core-util';
import { DicomReceiver } from '../dicom-receiver.js';
import { freePort } from '../../__fixtures__/free-port.js';

const { Client, Dataset, association: associations, constants, requests } = pkg;
const { PresentationContext } = associations;
const { CEchoRequest, CStoreRequest } = requests;
const { AbortReason, AbortSource, Status } = constants;

const IMPLICIT = '1.2.840.10008.1.2';
const CT = '1.2.840.10008.5.1.4.1.1.2';
const PROCESSED: Result<DispatchResult> = { ok: true, value: { messageId: 1, status: 'PROCESSED' }, error: null };
const TIMEOUTS = { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000 };

let dir: string;
let port: number;
let listener: DicomReceiver | null = null;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-listener-')));
  port = await freePort();
});

afterEach(async () => {
  await listener?.onStop();
  listener = null;
  await fs.rm(dir, { recursive: true, force: true });
});

function build(pipeline: (raw: RawMessage) => Promise<Result<DispatchResult>> = async () => PROCESSED): DicomReceiver {
  const receiver = new DicomReceiver({
    port,
    storageDir: dir,
    aeTitle: 'LISTENER',
    connectionTimeoutMs: 10_000,
    dispatchMode: 'PER_FILE',
    postAction: 'NONE',
    moveToDirectory: '',
    channelId: 'channel-1',
    roots: { allowed: [dir], denied: [] },
  });
  receiver.setDispatcher(pipeline as MessageDispatcher);
  listener = receiver;
  return receiver;
}

async function start(pipeline?: (raw: RawMessage) => Promise<Result<DispatchResult>>): Promise<DicomReceiver> {
  const receiver = build(pipeline);
  const started = await receiver.onStart();
  if (!started.ok) throw started.error;
  return receiver;
}

/** Any bytes, as a dataset of this transfer syntax. */
class RawDataset extends Dataset {
  constructor(sopClass: string, transferSyntax: string, private readonly bytes: Buffer) {
    super({ SOPClassUID: sopClass, SOPInstanceUID: '1.2.3' }, transferSyntax);
  }
  override getDenaturalizedDataset(): Buffer { return this.bytes; }
}

interface Outcome {
  /** The C-STORE's answer, when there was one. */
  readonly status?: number;
  readonly rejected?: boolean;
  readonly aborted?: boolean;
}

/** C-STORE one instance, its transfer syntax alone in its context as well; how it went. */
function store(sopClass = CT, transferSyntax = IMPLICIT): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    let outcome: Outcome = {};
    const client = new Client();
    const elements = Buffer.concat([uid(0x0016, sopClass, transferSyntax !== IMPLICIT), uid(0x0018, '1.2.3.4', transferSyntax !== IMPLICIT)]);
    const request = new CStoreRequest(new RawDataset(sopClass, transferSyntax, elements));
    request.on('response', (response: { getStatus(): number }) => { outcome = { ...outcome, status: response.getStatus() }; });
    client.addRequest(request);
    client.addAdditionalPresentationContext(new PresentationContext(0, sopClass, transferSyntax), true);
    client.on('associationRejected', () => { outcome = { ...outcome, rejected: true }; });
    client.on('abort', () => { outcome = { ...outcome, aborted: true }; });
    client.on('networkError', reject);
    client.on('closed', () => { resolve(outcome); });
    client.send('127.0.0.1', port, 'SCU', 'LISTENER', { ...TIMEOUTS, associationLingerTimeout: 200 });
  });
}

/** A (0008,xxxx) UI element. */
function uid(element: number, value: string, explicit: boolean): Buffer {
  const padded = Buffer.from(value.length % 2 === 0 ? value : `${value}\0`);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0008, 0);
  header.writeUInt16LE(element, 2);
  if (explicit) {
    header.write('UI', 4);
    header.writeUInt16LE(padded.length, 6);
  } else header.writeUInt32LE(padded.length, 4);
  return Buffer.concat([header, padded]);
}

describe('the storage SOP classes the listener takes', () => {
  it.each([
    ['CT Image', CT],
    ['RT Structure Set', '1.2.840.10008.5.1.4.1.1.481.3'],
    ['RT Plan', '1.2.840.10008.5.1.4.1.1.481.5'],
    ['RT Dose', '1.2.840.10008.5.1.4.1.1.481.2'],
    ['Segmentation', '1.2.840.10008.5.1.4.1.1.66.4'],
    ['Grayscale Softcopy Presentation State', '1.2.840.10008.5.1.4.1.1.11.1'],
    ['Key Object Selection', '1.2.840.10008.5.1.4.1.1.88.59'],
    ['12-lead ECG Waveform', '1.2.840.10008.5.1.4.1.1.9.1.1'],
    ['Comprehensive 3D SR', '1.2.840.10008.5.1.4.1.1.88.34'],
    ['Hanging Protocol', '1.2.840.10008.5.1.4.38.1'],
  ])('include %s', async (_name, sopClass) => {
    await start();
    expect(await store(sopClass)).toEqual({ status: Status.Success });
  });

  it.each([
    ['a query', '1.2.840.10008.5.1.4.1.2.2.1'],
    ['a query under the storage root', '1.2.840.10008.5.1.4.1.1.200.4'],
    ['an inventory creation', '1.2.840.10008.5.1.4.1.1.201.5'],
    ['a private class', '1.3.12.2.1107.5.9.1'],
  ])('do not include %s', async (_name, sopClass) => {
    await start();
    expect(await store(sopClass)).toEqual({});
  });

  it('leaves C-ECHO answered', async () => {
    await start();
    const status = await new Promise<number>((resolve, reject) => {
      const client = new Client();
      const request = new CEchoRequest();
      request.on('response', (response: { getStatus(): number }) => { resolve(response.getStatus()); });
      client.addRequest(request);
      client.on('networkError', reject);
      client.send('127.0.0.1', port, 'SCU', 'LISTENER', TIMEOUTS);
    });
    expect(status).toBe(Status.Success);
  });
});

describe('the transfer syntaxes the listener takes', () => {
  it.each([
    ['JPEG Extended', '1.2.840.10008.1.2.4.51'],
    ['JPEG Lossless', '1.2.840.10008.1.2.4.57'],
    ['JPEG Lossless, first-order prediction', '1.2.840.10008.1.2.4.70'],
    ['MPEG-4', '1.2.840.10008.1.2.4.102'],
    ['High-Throughput JPEG 2000', '1.2.840.10008.1.2.4.201'],
    ['RLE', '1.2.840.10008.1.2.5'],
    ['Encapsulated Uncompressed', '1.2.840.10008.1.2.1.98'],
    ['Deflated Image Frame', '1.2.840.10008.1.2.8.1'],
  ])('include %s', async (_name, transferSyntax) => {
    await start();
    expect(await store(CT, transferSyntax)).toEqual({ status: Status.Success });
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.dcm'))).toEqual(['1.2.3.4.dcm']);
  });

  // The image would be a URL at the sender's.
  it('do not include JPIP', async () => {
    await start();
    expect(await store(CT, '1.2.840.10008.1.2.4.94')).toEqual({});
  });
});

describe('starting the listener', () => {
  it('fails on a port in use, and works once it is free', async () => {
    const other = net.createServer();
    await new Promise<void>((resolve) => { other.listen(port, resolve); });
    const receiver = build();

    const refused = await receiver.onStart();

    expect(refused.ok ? 'started' : refused.error.message).toContain('EADDRINUSE');
    await new Promise<void>((resolve) => { other.close(() => { resolve(); }); });
    expect((await receiver.onStart()).ok).toBe(true);
    expect(await store()).toEqual({ status: Status.Success });
  });
});

describe('stopping the listener', () => {
  /** A listener whose pipeline has taken an image and not stored it yet. */
  async function taking(): Promise<{ receiver: DicomReceiver; sent: Promise<Outcome>; storeIt: () => void }> {
    let storeIt = (): void => undefined;
    let taken = (): void => undefined;
    const isTaken = new Promise<void>((resolve) => { taken = resolve; });
    const receiver = await start(async (raw) => {
      taken();
      await new Promise<void>((resolve) => { storeIt = resolve; });
      raw.onStored?.({ recoverable: true });
      return PROCESSED;
    });
    const sent = store();
    await isTaken;
    return { receiver, sent, storeIt: () => { storeIt(); } };
  }

  it('answers an image it has taken before it ends the association', async () => {
    const { receiver, sent, storeIt } = await taking();

    const stopped = receiver.onStop();
    storeIt();

    expect((await stopped).ok).toBe(true);
    expect(await sent).toEqual({ status: Status.Success, aborted: true });
  });

  it('takes no new association meanwhile', async () => {
    const { receiver, sent, storeIt } = await taking();
    const stopped = receiver.onStop();

    expect(await store()).toEqual({ rejected: true });

    storeIt();
    await stopped;
    await sent;
  });

  it('does not wait for an image that is never stored', async () => {
    const { receiver, sent } = await taking();
    const began = Date.now();

    expect((await receiver.onStop()).ok).toBe(true);
    expect(Date.now() - began).toBeLessThan(12_000);

    // Cut off without an answer, so the sender keeps the image.
    expect(await sent.catch(() => ({}))).not.toHaveProperty('status');
  });

  it('does not wait for a sender that hung up on an image it had taken', async () => {
    let storeIt = (): void => undefined;
    const receiver = await start(async (raw) => {
      await new Promise<void>((resolve) => { storeIt = resolve; });
      raw.onStored?.({ recoverable: true });
      return PROCESSED;
    });
    const client = new Client();
    client.addRequest(new CStoreRequest(new RawDataset(CT, IMPLICIT, Buffer.concat([uid(0x0016, CT, false), uid(0x0018, '1.2.3.4', false)]))));
    client.on('networkError', () => undefined);
    const closed = new Promise<void>((resolve) => { client.on('closed', () => { resolve(); }); });
    client.send('127.0.0.1', port, 'SCU', 'LISTENER', TIMEOUTS);
    await vi.waitFor(async () => { expect((await fs.readdir(dir)).length).toBe(1); }, 15_000);
    let stopped = false;
    const stopping = receiver.onStop().then(() => { stopped = true; });
    client.abort(AbortSource.ServiceUser, AbortReason.NotSpecified);
    await closed;
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    const began = Date.now();

    storeIt();
    await stopping;

    expect(stopped).toBe(true);
    // Well under the 5 s a stop waits at most.
    expect(Date.now() - began).toBeLessThan(3_000);
  });

  it('does not wait at all when it is halted', async () => {
    const { receiver, sent } = await taking();
    const began = Date.now();

    expect((await receiver.onHalt()).ok).toBe(true);

    expect(Date.now() - began).toBeLessThan(3_000);
    expect(await sent.catch(() => ({}))).not.toHaveProperty('status');
  });

  it('ends an association that is idle', async () => {
    const receiver = await start();
    const socket = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => { socket.once('connect', resolve); });
    const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve(); }); });
    socket.resume();
    socket.on('error', () => undefined);

    await receiver.onStop();

    await closed;
  });

  it('frees the port, so it can start again', async () => {
    const receiver = await start();
    await receiver.onStop();

    expect((await receiver.onStart()).ok).toBe(true);
    expect(await store()).toEqual({ status: Status.Success });
  });
});
