// Pure JavaScript (dcmjs-dimse), with no native binaries or external server, so it runs in the
// default lane like the other connectors.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DicomReceiver,
  DicomDispatcher,
  clearChannelRegistry,
} from '../../index.js';
import { createDimseSender } from '../../dicom/dimse-sender.js';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from './support/e2e-harness.js';
import { mllpSource, sendMllp } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';
import { startFakeScp, type FakeScp, type ScpBehaviour } from '../../__fixtures__/fake-scp.js';

const SCP_PORT = await freePort();
const TCP_PORT = await freePort();
const QUEUE_LISTENER_PORT = await freePort();
const QUEUE_PACS_PORT = await freePort();
/** Where a test's DICOM Listeners may write (FILE_CONNECTOR_ROOTS). */
const TMP_ROOTS = { allowed: [os.tmpdir()], denied: [] };
const SAMPLE_DCM = fileURLToPath(new URL('./fixtures/sample.dcm', import.meta.url));

let deployed: DeployedChannel[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  clearChannelRegistry();
});

describe('DICOM connector cascade (dcmjs-dimse SCU → SCP)', () => {
  it('Channel A stores a DICOM object to Channel B\'s SCP over C-STORE', async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-dicom-'));
    tempDirs.push(storageDir);

    const sink = new CaptureDestination();

    // The SCP source's message content is the received file's path.
    const channelB = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom00b',
      dataType: 'RAW',
      source: new DicomReceiver({
        port: SCP_PORT,
        storageDir,
        aeTitle: 'TESTSCP',
        connectionTimeoutMs: 15_000,
        dispatchMode: 'PER_FILE',
        postAction: 'NONE',
        moveToDirectory: '',
        roots: TMP_ROOTS,
      }),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom00a',
      dataType: 'RAW',
      source: mllpSource(TCP_PORT, { maxConnections: 10 }),
      destinations: [{
        metaDataId: 1,
        name: 'DICOM Out',
        connector: new DicomDispatcher({
          host: '127.0.0.1',
          port: SCP_PORT,
          calledAETitle: 'TESTSCP',
          callingAETitle: 'TESTSCU',
          maxRetries: 0,
          retryDelayMs: 0,
          timeoutMs: 20_000,
          roots: { allowed: [path.dirname(SAMPLE_DCM)], denied: [] },
        }),
      }],
    });
    deployed.push(channelA, channelB);

    // The message content IS the .dcm file path the SCU should send.
    await sendMllp(TCP_PORT, SAMPLE_DCM, 20_000);

    for (let i = 0; i < 400 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    const receivedPath = sink.lastContent() ?? '';
    const head = await fs.readFile(receivedPath);
    // The received file is a real DICOM object: 128-byte preamble + "DICM".
    expect(head.subarray(128, 132).toString('ascii')).toBe('DICM');
    expect(head.length).toBeGreaterThan(1000);
  }, 45_000);

  // #243: the Listener deleted its stored file as soon as the message was
  // queued, so the Sender's retry found no file and the image never arrived.
  it('a queued DICOM Sender delivers the image once the PACS comes up, and the Listener deletes its copy only then', async () => {
    const listenerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-dicom-listener-'));
    const pacsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-dicom-pacs-'));
    tempDirs.push(listenerDir, pacsDir);

    // DICOM Listener (deletes its file after processing) → DICOM Sender that
    // queues on failure. Nothing listens on the PACS port yet.
    const listener = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom0ql',
      dataType: 'RAW',
      source: new DicomReceiver({
        port: QUEUE_LISTENER_PORT,
        storageDir: listenerDir,
        aeTitle: 'LISTENER',
        connectionTimeoutMs: 15_000,
        dispatchMode: 'PER_FILE',
        postAction: 'DELETE',
        moveToDirectory: '',
        roots: TMP_ROOTS,
      }),
      destinations: [{
        metaDataId: 1,
        name: 'PACS',
        queueMode: 'ON_FAILURE',
        retryIntervalMs: 200,
        connector: new DicomDispatcher({
          host: '127.0.0.1',
          port: QUEUE_PACS_PORT,
          calledAETitle: 'PACS',
          callingAETitle: 'LISTENER',
          maxRetries: 0,
          retryDelayMs: 0,
          timeoutMs: 5_000,
          roots: { allowed: [listenerDir], denied: [] },
        }),
      }],
    });
    deployed.push(listener);

    // A modality stores the image on the Listener.
    const modality = createDimseSender({
      host: '127.0.0.1',
      port: QUEUE_LISTENER_PORT,
      calledAETitle: 'LISTENER',
      callingAETitle: 'MODALITY',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 10_000,
    });
    if (!modality.ok) throw modality.error;
    const stored = await modality.value.send([SAMPLE_DCM]);
    expect(stored.ok).toBe(true);

    // The first send fails (no PACS) and the destination waits in the queue.
    await waitFor(() => listener.store.connectorMessages.some(
      (m) => m.metaDataId === 1 && m.sendAttempts >= 1,
    ), 10_000);
    expect(await fs.readdir(listenerDir)).toHaveLength(1);

    // The PACS comes up.
    const pacsSink = new CaptureDestination();
    const pacs = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom0qp',
      dataType: 'RAW',
      source: new DicomReceiver({
        port: QUEUE_PACS_PORT,
        storageDir: pacsDir,
        aeTitle: 'PACS',
        connectionTimeoutMs: 15_000,
        dispatchMode: 'PER_FILE',
        postAction: 'NONE',
        moveToDirectory: '',
        roots: TMP_ROOTS,
      }),
      destinations: [{ metaDataId: 1, name: 'archive', connector: pacsSink }],
    });
    deployed.push(pacs);

    await waitFor(() => pacsSink.received.length > 0, 15_000);
    const received = await fs.readFile(pacsSink.lastContent() ?? '');
    expect(received.subarray(128, 132).toString('ascii')).toBe('DICM');
    expect(received.length).toBeGreaterThan(1000);

    // Delivered everywhere, so the Listener's DELETE runs now.
    await waitFor(async () => (await fs.readdir(listenerDir)).length === 0, 5_000);
    expect(listener.store.connectorMessages.find((m) => m.metaDataId === 1)?.status).toBe('SENT');
  }, 60_000);
});

describe('DICOM archive that does not store the image (#410)', () => {
  let archive: FakeScp | null = null;

  afterEach(() => {
    archive?.close();
    archive = null;
  });

  /** A DICOM Listener that deletes its file once delivered, in front of an archive, given one image. */
  async function storeThrough(behaviour: ScpBehaviour, queueMode: 'NEVER' | 'ON_FAILURE'): Promise<{ channel: DeployedChannel; storageDir: string }> {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-dicom-refused-'));
    tempDirs.push(storageDir);
    archive = await startFakeScp(behaviour);
    const port = await freePort();
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom0rf',
      dataType: 'RAW',
      source: new DicomReceiver({
        port,
        storageDir,
        aeTitle: 'LISTENER',
        connectionTimeoutMs: 15_000,
        dispatchMode: 'PER_FILE',
        postAction: 'DELETE',
        moveToDirectory: '',
        roots: TMP_ROOTS,
      }),
      destinations: [{
        metaDataId: 1,
        name: 'Archive',
        queueMode,
        retryIntervalMs: 100,
        connector: new DicomDispatcher({
          host: '127.0.0.1',
          port: archive.port,
          calledAETitle: 'ARCHIVE',
          callingAETitle: 'LISTENER',
          maxRetries: 0,
          retryDelayMs: 0,
          timeoutMs: 5_000,
          roots: { allowed: [storageDir], denied: [] },
        }),
      }],
    });
    deployed.push(channel);
    const modality = createDimseSender({
      host: '127.0.0.1',
      port,
      calledAETitle: 'LISTENER',
      callingAETitle: 'MODALITY',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 10_000,
    });
    if (!modality.ok) throw modality.error;
    const stored = await modality.value.send([SAMPLE_DCM]);
    if (!stored.ok) throw stored.error;
    return { channel, storageDir };
  }

  function destinationOf(channel: DeployedChannel): { readonly status: string; readonly sendAttempts: number } | undefined {
    return channel.store.connectorMessages.find((m) => m.metaDataId === 1);
  }

  it.each<[string, ScpBehaviour]>([
    ['refuses the C-STORE', { answer: 0xA700 }],
    ['accepts no presentation context', 'reject-contexts'],
    ['aborts before it answers', 'abort'],
    ['hangs up before it answers', 'close'],
  ])('records ERROR and keeps the Listener\'s file when the archive %s', async (_case, behaviour) => {
    const { channel, storageDir } = await storeThrough(behaviour, 'NEVER');

    await waitFor(() => channel.store.messages[0]?.processed === true, 10_000);

    expect(destinationOf(channel)?.status).toBe('ERROR');
    expect(await fs.readdir(storageDir)).toHaveLength(1);
  }, 30_000);

  it('keeps a refused image queued, and its file, until the archive stores it', async () => {
    const { channel, storageDir } = await storeThrough({ answer: 0xA700 }, 'ON_FAILURE');

    await waitFor(() => (destinationOf(channel)?.sendAttempts ?? 0) >= 1, 15_000);
    expect(destinationOf(channel)?.status).not.toBe('SENT');
    expect(await fs.readdir(storageDir)).toHaveLength(1);

    // A warning: stored, with elements coerced.
    if (archive) archive.behaviour = { answer: 0xB000 };

    await waitFor(() => destinationOf(channel)?.status === 'SENT', 15_000);
    await waitFor(async () => (await fs.readdir(storageDir)).length === 0, 5_000);
  }, 45_000);
});

/** Poll until `check` holds, or fail after `timeoutMs`. */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
