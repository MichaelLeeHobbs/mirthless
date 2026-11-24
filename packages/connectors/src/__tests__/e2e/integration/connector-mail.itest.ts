import { it, expect, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import {
  SmtpDispatcher,
  EmailReceiver,
  clearChannelRegistry,
} from '../../../index.js';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from '../support/e2e-harness.js';
import { mllpSource, sendMllp } from '../support/tcp-helpers.js';
import { describeMail, requireMail } from './gates.js';
import { freePort } from '../../../__fixtures__/free-port.js';

const TCP_PORT = await freePort();

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

describeMail('SMTP + IMAP connector cascade (real GreenMail)', () => {
  it('Channel A emails the message via SMTP; Channel B\'s IMAP source picks it up', async () => {
    const cfg = requireMail();
    const address = cfg.address;

    const sink = new CaptureDestination();

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
      }),
      transformer: "return String(msg).trim() + '::mail';",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    const channelA = await deployChannel({
      channelId: '00000000-0000-0000-0000-connmail000a',
      dataType: 'RAW',
      source: mllpSource(TCP_PORT, { maxConnections: 10 }),
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

    for (let i = 0; i < 300 && sink.received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    expect(sink.lastContent()).toContain('MAILTEST-PAYLOAD');
    expect(sink.lastContent()).toContain('::mail');
  });

  it('does not dispatch an email again after a restart when its post-action keeps failing', async () => {
    const cfg = requireMail();
    const subject = `E2E-RESTART-${Date.now()}`;
    await nodemailer.createTransport({ host: cfg.host, port: cfg.smtpPort, secure: false })
      .sendMail({ from: cfg.address, to: cfg.address, subject, text: 'RESTART-PAYLOAD' });

    // MOVE to a missing folder fails the post-action and leaves the email unread in INBOX.
    const deployReceiver = async (n: number, sink: CaptureDestination): Promise<DeployedChannel> => {
      const channel = await deployChannel({
        channelId: `00000000-0000-0000-0000-connmailrst${n}`,
        dataType: 'RAW',
        source: new EmailReceiver({
          host: cfg.host, port: cfg.imapPort, secure: false,
          username: cfg.username, password: cfg.password, protocol: 'IMAP',
          folder: 'INBOX', pollingIntervalMs: 1000, postAction: 'MOVE',
          moveToFolder: 'Does-Not-Exist', subjectFilter: subject,
        }),
        destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
      });
      deployed.push(channel);
      return channel;
    };

    const firstSink = new CaptureDestination();
    const first = await deployReceiver(1, firstSink);
    await vi.waitFor(() => { expect(firstSink.received).toHaveLength(1); }, { timeout: 15_000, interval: 50 });
    await first.teardown();
    deployed = deployed.filter((c) => c !== first);

    const secondSink = new CaptureDestination();
    await deployReceiver(2, secondSink);
    await new Promise((r) => setTimeout(r, 3_500)); // three polls

    expect(secondSink.received).toHaveLength(0);
  });
});
