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
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from './support/e2e-harness.js';
import { mllpSource, sendMllp } from './support/tcp-helpers.js';

const SCP_PORT = 11114;
const TCP_PORT = 17762;
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
        minPoolSize: 1,
        maxPoolSize: 2,
        connectionTimeoutMs: 15_000,
        dispatchMode: 'PER_FILE',
        postAction: 'NONE',
        moveToDirectory: '',
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
          mode: 'single',
          maxAssociations: 1,
          maxRetries: 0,
          retryDelayMs: 0,
          timeoutMs: 20_000,
          allowedBaseDir: path.dirname(SAMPLE_DCM),
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
});
