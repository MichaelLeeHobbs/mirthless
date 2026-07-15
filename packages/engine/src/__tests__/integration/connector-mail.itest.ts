// ===========================================
// SMTP + IMAP connector cascade — real GreenMail server
// ===========================================
//   Channel A: TCP source → SMTP destination (sends an email).
//   Channel B: Email (IMAP) source polls the inbox → transform → sink.
// A message pushed into A is emailed, picked up over IMAP by B, and delivered.
// Runs only when SMTP_TEST_HOST is set (docker compose --profile test up mail-test).

import { it, expect, afterEach } from 'vitest';
import {
  TcpMllpReceiver,
  SmtpDispatcher,
  EmailReceiver,
  clearChannelRegistry,
} from '@mirthless/connectors';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { sendMllp } from '../support/tcp-helpers.js';
import { describeMail, requireMail } from './gates.js';

const TCP_PORT = 17751;

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

describeMail('SMTP + IMAP connector cascade (real GreenMail)', () => {
  it('Channel A emails the message via SMTP; Channel B\'s IMAP source picks it up', async () => {
    const cfg = requireMail();
    const address = cfg.address; // envelope email, e.g. mirth@example.com

    const sink = new CaptureDestination();

    // Channel B: IMAP source polls INBOX for our subject.
    const channelB = await deployChannel({
      channelId: '00000000-0000-0000-0000-connmail000b',
      dataType: 'RAW',
      source: new EmailReceiver({
        host: cfg.host,
        port: cfg.imapPort,
        secure: false,
        username: cfg.username,
        password: cfg.password,
        protocol: 'IMAP',
        folder: 'INBOX',
        pollingIntervalMs: 1000,
        postAction: 'MARK_READ',
        moveToFolder: '',
        subjectFilter: 'E2E-MAIL',
        includeAttachments: false,
      }),
      transformer: "return String(msg).trim() + '::mail';",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    // Channel A: TCP source → SMTP destination emails ${msg}.
    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-connmail000a',
      dataType: 'RAW',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: TCP_PORT, maxConnections: 10 }),
      destinations: [{
        metaDataId: 1,
        name: 'SMTP Out',
        connector: new SmtpDispatcher({
          host: cfg.host,
          port: cfg.smtpPort,
          secure: false,
          requireTLS: false,
          from: address,
          to: address,
          cc: '',
          bcc: '',
          subject: 'E2E-MAIL',
          bodyTemplate: '${msg}',
          contentType: 'text/plain',
          attachContent: false,
        }),
      }],
    });
    deployed.push(channelA, channelB);

    await sendMllp(TCP_PORT, 'MAILTEST-PAYLOAD');

    // Wait for SMTP delivery + the 1s IMAP poll to pick it up.
    for (let i = 0; i < 300 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    expect(sink.lastContent()).toContain('MAILTEST-PAYLOAD');
    expect(sink.lastContent()).toContain('::mail');
  });
});
