import { it, expect, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import {
  SmtpDispatcher,
  EmailReceiver,
  clearChannelRegistry,
} from '../../../index.js';
import { deployChannel, teardownAll, CaptureDestination, type ChannelSpec, type DeployedChannel } from '../support/e2e-harness.js';
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

  const sendEmail = async (subject: string, text: string): Promise<void> => {
    const cfg = requireMail();
    await nodemailer.createTransport({ host: cfg.host, port: cfg.smtpPort, secure: false })
      .sendMail({ from: cfg.address, to: cfg.address, subject, text });
  };

  let next = 0;
  async function deployReader(subject: string, spec: Pick<ChannelSpec, 'destinations' | 'transformer'>): Promise<DeployedChannel> {
    const cfg = requireMail();
    next += 1;
    const channel = await deployChannel({
      channelId: `00000000-0000-0000-0000-connmail41${String(next).padStart(2, '0')}`,
      dataType: 'RAW',
      source: new EmailReceiver({
        host: cfg.host, port: cfg.imapPort, secure: false,
        username: cfg.username, password: cfg.password, protocol: 'IMAP',
        folder: 'INBOX', pollingIntervalMs: 1000, postAction: 'MARK_READ', moveToFolder: '', subjectFilter: subject,
      }),
      ...spec,
    });
    deployed.push(channel);
    return channel;
  }

  async function redeploy(channel: DeployedChannel): Promise<void> {
    await channel.teardown();
    deployed = deployed.filter((c) => c !== channel);
  }

  it('does not dispatch an email recorded with an error again after a redeploy (#413)', async () => {
    const subject = `E2E-ERROR-${Date.now()}`;
    await sendEmail(subject, 'ERROR-PAYLOAD');
    const sink = new CaptureDestination();
    const first = await deployReader(subject, {
      transformer: "throw new Error('cannot be transformed');",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    await vi.waitFor(() => { expect(first.store.messageCount()).toBe(1); }, { timeout: 15_000, interval: 50 });
    await redeploy(first);

    const second = await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: sink }] });
    await new Promise((r) => setTimeout(r, 3_500)); // three polls

    expect(second.store.messageCount()).toBe(0);
    expect(sink.received).toEqual([]);
  });

  it('a stop takes no email after the one in hand, and a redeploy delivers each once (#413)', async () => {
    const subject = `E2E-STOP-${Date.now()}`;
    await sendEmail(subject, 'PAYLOAD-ONE');
    await sendEmail(subject, 'PAYLOAD-TWO');
    let reached = (): void => undefined;
    const sending = new Promise<void>((resolve) => { reached = resolve; });
    let letGo = (): void => undefined;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    const firstSink = new CaptureDestination();
    const send = firstSink.send.bind(firstSink);
    vi.spyOn(firstSink, 'send').mockImplementation(async (message, signal) => {
      reached();
      await held;
      return send(message, signal);
    });
    const first = await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: firstSink }] });
    await sending;

    const stopping = first.runtime.stop();
    letGo();
    expect((await stopping).ok).toBe(true);
    await redeploy(first);
    expect(firstSink.received).toHaveLength(1);

    const secondSink = new CaptureDestination();
    await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: secondSink }] });
    await vi.waitFor(() => { expect(secondSink.received).toHaveLength(1); }, { timeout: 15_000, interval: 50 });
    await new Promise((r) => setTimeout(r, 2_500)); // two more polls

    const delivered = [...firstSink.received, ...secondSink.received].map((m) => /PAYLOAD-(ONE|TWO)/.exec(m.content)?.[0]);
    expect(delivered.sort()).toEqual(['PAYLOAD-ONE', 'PAYLOAD-TWO']);
  });
});
