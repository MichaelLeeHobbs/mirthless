// ===========================================
// DICOM connector cascade — real dcmtk SCU → SCP
// ===========================================
//   Channel A: TCP source (message = a .dcm file path) → DICOM destination
//              (storescu sends the file via C-STORE).
//   Channel B: DICOM source (storescp SCP receives the C-STORE, writes the file)
//              → sink.
// Intended to prove the DICOM connectors move a real DICOM object over the wire.
//
// STATUS: opt-in reproducer, NOT part of any default run (gated on
// DICOM_TEST_ENABLED=1; the standard `pnpm test` and `test:integration` runs skip
// it). It currently FAILS at DICOM association negotiation: dcmtk storescu reports
//   "Association Rejected: Result: Rejected Permanent, Source: Service User"
// even though the SCP is reachable (it creates the association directory). The
// receiver wrapper (packages/connectors/src/dicom/dicom-receiver.ts
// defaultReceiverFactory) calls DcmtkDicomReceiver.create with no accepted
// SOP-class / presentation-context configuration, so the SCP rejects the SCU's
// proposed context. This is a real DICOM-connector gap to fix; once the SCP
// negotiates a presentation context for the object's SOP class, this test should
// pass unchanged. Kept as a ready reproducer (fixture + harness wiring in place).

import { it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TcpMllpReceiver,
  DicomReceiver,
  DicomDispatcher,
  clearChannelRegistry,
} from '@mirthless/connectors';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { sendMllp } from '../support/tcp-helpers.js';
import { describeDicom } from './gates.js';

const SCP_PORT = 11112;
const TCP_PORT = 17761;
const SAMPLE_DCM = fileURLToPath(new URL('../fixtures/sample.dcm', import.meta.url));

let deployed: DeployedChannel[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  clearChannelRegistry();
});

describeDicom('DICOM connector cascade (real dcmtk SCU → SCP)', () => {
  beforeAll(async () => {
    // Fail loudly if the vendored fixture is missing.
    await fs.access(SAMPLE_DCM);
  });

  it('Channel A stores a DICOM object to Channel B\'s SCP over C-STORE', async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mless-dicom-'));
    tempDirs.push(storageDir);

    const sink = new CaptureDestination();

    // Channel B: DICOM SCP source → sink (content = received file path).
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

    // Channel A: TCP source (message = the .dcm path) → DICOM SCU destination.
    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-conndicom00a',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: TCP_PORT, maxConnections: 10 }),
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

    // Wait for the C-STORE association to complete and the SCP to dispatch.
    for (let i = 0; i < 400 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    const receivedPath = sink.lastContent() ?? '';
    const stat = await fs.stat(receivedPath);
    expect(stat.size).toBeGreaterThan(0);
    // The received file is a real DICOM object (starts with the 128-byte preamble + "DICM").
    const head = await fs.readFile(receivedPath);
    expect(head.subarray(128, 132).toString('ascii')).toBe('DICM');
  }, 60_000);
});
