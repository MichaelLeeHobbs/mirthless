// ===========================================
// SFTP connector cascade — real SFTP server
// ===========================================
// The vision's "Channel SFTP listen + another channel with an SFTP destination":
//   Channel A: TCP source → SFTP destination (uploads a file to the server).
//   Channel B: SFTP source (polls the same dir) → transform → sink.
// A message pushed into A is uploaded over SFTP, picked up by B, and delivered.
// Runs only when SFTP_TEST_HOST is set (docker compose --profile test up sftp-test).

import { it, expect, afterEach } from 'vitest';
import {
  TcpMllpReceiver,
  SftpReceiver,
  SftpDispatcher,
  SFTP_POST_ACTION,
  clearChannelRegistry,
} from '@mirthless/connectors';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { sendMllp } from '../support/tcp-helpers.js';
import { describeSftp, requireSftp } from './gates.js';

const TCP_PORT = 17741;

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

describeSftp('SFTP connector cascade (real SFTP server)', () => {
  it('Channel A uploads via SFTP destination; Channel B\'s SFTP source picks it up', async () => {
    const cfg = requireSftp();
    const conn = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      strictHostKey: false,
    };

    const sink = new CaptureDestination();

    // Channel B: SFTP source polls the upload dir, deletes after processing.
    const channelB = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000b',
      dataType: 'RAW',
      source: new SftpReceiver({
        ...conn,
        remoteDirectory: cfg.baseDir,
        filePattern: '*.hl7',
        pollingIntervalMs: 200,
        afterProcessing: SFTP_POST_ACTION.DELETE,
        moveToDirectory: '',
        minFileAgeMs: 0,
      }),
      transformer: "return String(msg) + '::sftp';",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    // Channel A: TCP source → SFTP destination uploads ${messageId}.hl7.
    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-connsftp000a',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: TCP_PORT, maxConnections: 10 }),
      destinations: [{
        metaDataId: 1,
        name: 'SFTP Out',
        connector: new SftpDispatcher({
          ...conn,
          remoteDirectory: cfg.baseDir,
          fileNameTemplate: 'msg-${messageId}.hl7',
          appendMode: false,
        }),
      }],
    });
    deployed.push(channelA, channelB);

    await sendMllp(TCP_PORT, 'MSH|^~\\&|SFTPTEST');

    // Wait for the upload → poll → download → deliver round trip.
    for (let i = 0; i < 300 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(sink.received).toHaveLength(1);
    expect(sink.lastContent()).toBe('MSH|^~\\&|SFTPTEST::sftp');
  });
});
