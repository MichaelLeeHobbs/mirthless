import { it, expect, afterEach, vi } from 'vitest';
import { ImapFlow } from 'imapflow';
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
import { DISPATCHED_KEYWORD, ERROR_KEYWORD } from '../../../email/imap-client.js';

const TCP_PORT = await freePort();

const WAIT = { timeout: 20_000, interval: 100 };
const TEST_TIMEOUT = 60_000;

/** A test that failed has not let them go, and the teardown would wait for them. */
const held: Array<() => void> = [];

/** A sink that holds its first message until it is let go. */
function heldSink(): { readonly sink: CaptureDestination; readonly reached: Promise<void>; readonly letGo: () => void } {
  let reach = (): void => undefined;
  let letGo = (): void => undefined;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  const gate = new Promise<void>((resolve) => { letGo = resolve; });
  const sink = new CaptureDestination();
  const send = sink.send.bind(sink);
  vi.spyOn(sink, 'send').mockImplementation(async (message, signal) => {
    reach();
    await gate;
    return send(message, signal);
  });
  held.push(letGo);
  return { sink, reached, letGo };
}

let deployed: DeployedChannel[] = [];
afterEach(async () => {
  for (const letGo of held.splice(0)) letGo();
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
    await vi.waitFor(() => { expect(firstSink.received).toHaveLength(1); }, WAIT);
    await first.teardown();
    deployed = deployed.filter((c) => c !== first);

    const secondSink = new CaptureDestination();
    await deployReceiver(2, secondSink);
    await new Promise((r) => setTimeout(r, 3_500)); // three polls

    expect(secondSink.received).toHaveLength(0);
  }, TEST_TIMEOUT);

  const sendEmail = async (subject: string, text: string): Promise<void> => {
    const cfg = requireMail();
    await nodemailer.createTransport({ host: cfg.host, port: cfg.smtpPort, secure: false })
      .sendMail({ from: cfg.address, to: cfg.address, subject, text });
  };

  let next = 0;
  async function deployReader(
    subject: string,
    spec: Pick<ChannelSpec, 'destinations' | 'transformer'>,
    postAction: 'MARK_READ' | 'DELETE' = 'MARK_READ',
  ): Promise<DeployedChannel> {
    const cfg = requireMail();
    next += 1;
    const channel = await deployChannel({
      channelId: `00000000-0000-0000-0000-connmail41${String(next).padStart(2, '0')}`,
      dataType: 'RAW',
      source: new EmailReceiver({
        host: cfg.host, port: cfg.imapPort, secure: false,
        username: cfg.username, password: cfg.password, protocol: 'IMAP',
        folder: 'INBOX', pollingIntervalMs: 1000, postAction, moveToFolder: '', subjectFilter: subject,
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
    await vi.waitFor(() => { expect(first.store.messageCount()).toBe(1); }, WAIT);
    await redeploy(first);

    const second = await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: sink }] });
    // Listed behind it, so once it is delivered the first had its turn.
    await sendEmail(subject, 'BEHIND-IT');
    await vi.waitFor(() => { expect(sink.lastContent()).toContain('BEHIND-IT'); }, WAIT);

    expect(second.store.messageCount()).toBe(1);
    expect(sink.received).toHaveLength(1);
  }, TEST_TIMEOUT);

  it('marks an email whose channel was halted while a stop waited for it, so a redeploy does not dispatch it again (#413)', async () => {
    const subject = `E2E-STOP-HALT-${Date.now()}`;
    await sendEmail(subject, 'IN-HAND');
    const { sink: firstSink, reached, letGo } = heldSink();
    const first = await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: firstSink }] });
    await reached;

    const stopping = first.runtime.stop();
    expect((await first.runtime.halt()).ok).toBe(true);
    letGo();
    expect((await stopping).ok).toBe(false);
    await redeploy(first);

    const secondSink = new CaptureDestination();
    await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: secondSink }] });
    await sendEmail(subject, 'BEHIND-IT');
    await vi.waitFor(() => { expect(secondSink.lastContent()).toContain('BEHIND-IT'); }, WAIT);

    expect(firstSink.received).toHaveLength(1);
    expect(secondSink.received).toHaveLength(1);
  }, TEST_TIMEOUT);

  it('a stop takes no email after the one in hand, and a redeploy delivers each once (#413)', async () => {
    const subject = `E2E-STOP-${Date.now()}`;
    await sendEmail(subject, 'PAYLOAD-ONE');
    await sendEmail(subject, 'PAYLOAD-TWO');
    const { sink: firstSink, reached, letGo } = heldSink();
    const first = await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: firstSink }] });
    await reached;

    const stopping = first.runtime.stop();
    letGo();
    expect((await stopping).ok).toBe(true);
    await redeploy(first);
    expect(firstSink.received).toHaveLength(1);

    const secondSink = new CaptureDestination();
    await deployReader(subject, { destinations: [{ metaDataId: 1, name: 'sink', connector: secondSink }] });
    await sendEmail(subject, 'PAYLOAD-THREE');
    await vi.waitFor(() => { expect(secondSink.lastContent()).toContain('PAYLOAD-THREE'); }, WAIT);

    const delivered = [...firstSink.received, ...secondSink.received].map((m) => /PAYLOAD-(ONE|TWO|THREE)/.exec(m.content)?.[0]);
    expect(delivered).toEqual(['PAYLOAD-ONE', 'PAYLOAD-TWO', 'PAYLOAD-THREE']);
  }, TEST_TIMEOUT);

  /** A mail client of its own, as a person or another program has the mailbox open. */
  async function withMailbox<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const cfg = requireMail();
    const client = new ImapFlow({
      host: cfg.host, port: cfg.imapPort, secure: false, auth: { user: cfg.username, pass: cfg.password }, logger: false,
    });
    await client.connect();
    try {
      await client.mailboxOpen('INBOX');
      return await work(client);
    } finally {
      await client.logout();
    }
  }

  /** Subject to flags of every email in the folder whose subject holds the text. */
  function inMailbox(text: string): Promise<Map<string, ReadonlySet<string>>> {
    return withMailbox(async (client) => {
      const found = new Map<string, ReadonlySet<string>>();
      for await (const email of client.fetch('1:*', { envelope: true, flags: true })) {
        const subject = email.envelope?.subject ?? '';
        if (subject.includes(text)) found.set(subject, email.flags ?? new Set());
      }
      return found;
    });
  }

  async function flag(subject: string, flags: string[]): Promise<void> {
    await withMailbox(async (client) => {
      const uids = await client.search({ subject }, { uid: true });
      expect(uids).toHaveLength(1);
      await client.messageFlagsAdd(uids as number[], flags, { uid: true });
    });
  }

  it('reads an email byte for byte, whatever its charset, and counts its attachments (#369)', async () => {
    const run = `E2E-BYTES-${String(Date.now())}`;
    const part = (headers: string, body: string): string => `--b\r\n${headers}\r\n\r\n${body}\r\n`;
    const email = (subject: string, charset: string): string => [
      `Subject: ${run}-${subject}`, 'From: lab@example.com', 'To: mirth@example.com', 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary=b', '', '',
    ].join('\r\n')
      + part(`Content-Type: text/plain; charset=${charset}\r\nContent-Transfer-Encoding: 8bit`, 'M\u00fcller')
      + part('Content-Type: application/pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\nContent-Transfer-Encoding: base64', 'JVBERi0xLjQ=')
      + part('Content-Type: message/rfc822', 'Subject: inner\r\nContent-Type: text/plain\r\n\r\ninner')
      + '--b--\r\n';
    const utf8 = Buffer.from(email('utf8', 'utf-8'), 'utf8');
    const latin1 = Buffer.from(email('latin1', 'iso-8859-1'), 'latin1');
    const plain = Buffer.from(`Subject: ${run}-plain\r\nContent-Type: text/plain\r\n\r\nMSH|\r\n`);
    await withMailbox(async (client) => {
      for (const raw of [utf8, latin1, plain]) await client.append('INBOX', raw);
    });
    const held = await withMailbox(async (client) => {
      const found = new Map<string, Buffer>();
      for await (const row of client.fetch('1:*', { envelope: true, source: true })) found.set(row.envelope?.subject ?? '', row.source ?? Buffer.alloc(0));
      return found;
    });

    const sink = new CaptureDestination();
    await deployReader(run, {
      transformer: "return JSON.stringify({ subject: sourceMap.subject, charset: sourceMap.charset, attachments: sourceMap.attachmentCount, text: String(msg) });",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    }, 'DELETE');
    await vi.waitFor(() => { expect(sink.received).toHaveLength(3); }, WAIT);

    const read = new Map(sink.received.map((m) => {
      const { subject, ...rest } = JSON.parse(m.content) as { subject: string; charset: BufferEncoding; attachments: number; text: string };
      return [subject, { ...rest, bytes: Buffer.from(rest.text, rest.charset) }];
    }));
    expect([...read].map(([subject, { charset, attachments }]) => [subject, charset, attachments]).sort()).toEqual([
      [`${run}-latin1`, 'latin1', 2],
      [`${run}-plain`, 'utf-8', 0],
      [`${run}-utf8`, 'utf-8', 2],
    ]);
    for (const [subject, { bytes }] of read) expect(bytes.equals(held.get(subject)!)).toBe(true);
    expect(held.get(`${run}-latin1`)!.includes(Buffer.from('M\u00fcller', 'latin1'))).toBe(true);
    await vi.waitFor(async () => { expect((await inMailbox(run)).size).toBe(0); }, WAIT);
  }, TEST_TIMEOUT);

  it('DELETE removes the emails it recorded and no other, whoever flagged that deleted (#413)', async () => {
    const run = `E2E-DELETE-${String(Date.now())}`;
    const filter = `${run}-HL7`;
    const subjects = {
      recorded: `${filter}-recorded`,
      error: `${filter}-error`,
      before: `${filter}-before`,
      other: `${run}-other`,
    };
    await sendEmail(subjects.before, 'BEFORE');
    await sendEmail(subjects.other, 'OTHER');
    await sendEmail(subjects.error, 'MAKE-IT-FAIL');
    // As an earlier version left it, and as a mail client flags an email before it is expunged.
    await flag(subjects.before, ['\\Deleted', DISPATCHED_KEYWORD]);
    await flag(subjects.other, ['\\Deleted']);
    const spec = (sink: CaptureDestination): Pick<ChannelSpec, 'destinations' | 'transformer'> => ({
      transformer: "if (String(msg).includes('MAKE-IT-FAIL')) throw new Error('cannot be transformed'); return msg;",
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });

    const sink = new CaptureDestination();
    const first = await deployReader(filter, spec(sink), 'DELETE');
    await sendEmail(subjects.recorded, 'RECORDED');
    await vi.waitFor(async () => {
      expect([...(await inMailbox(run)).keys()].sort()).toEqual([subjects.before, subjects.error, subjects.other].sort());
    }, WAIT);
    await vi.waitFor(async () => {
      expect([...(await inMailbox(run)).get(subjects.error)!].map((f) => f.toLowerCase())).toContain(ERROR_KEYWORD.toLowerCase());
    }, WAIT);
    expect(sink.received).toHaveLength(1);
    expect(sink.lastContent()).toContain('RECORDED');
    await redeploy(first);

    const again = new CaptureDestination();
    const second = await deployReader(filter, spec(again), 'DELETE');
    await sendEmail(`${filter}-behind`, 'BEHIND');
    await vi.waitFor(async () => {
      expect([...(await inMailbox(run)).keys()].sort()).toEqual([subjects.before, subjects.error, subjects.other].sort());
      expect(again.received).toHaveLength(1);
    }, WAIT);

    expect(second.store.messageCount()).toBe(1);
  }, TEST_TIMEOUT);
});
