import * as net from 'node:net';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import { ChannelReceiver, SmtpDispatcher, clearChannelRegistry, getChannelDispatcher } from '../../index.js';
import { deployChannel, teardownAll, type DeployedChannel } from './support/e2e-harness.js';

interface Taken { readonly recipients: string[]; data: string }

/**
 * A mail server that refuses every recipient whose address starts with `gone`, as Postfix answers RCPT TO for a
 * mailbox that does not exist, quoting the address, and takes the email for the others. It offers PIPELINING, as
 * most servers do, so nodemailer sends the whole envelope at once. No library offers that without a download.
 */
async function startRefusingSmtpServer(): Promise<{ readonly port: number; readonly taken: Taken[]; close(): void }> {
  const taken: Taken[] = [];
  const server = net.createServer((socket) => {
    let current: Taken = { recipients: [], data: '' };
    let inData = false;
    let buffer = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (let end = buffer.indexOf('\r\n'); end !== -1; end = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { inData = false; taken.push(current); current = { recipients: [], data: '' }; socket.write('250 2.0.0 queued\r\n'); } else current.data += `${line}\n`;
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') socket.write('250-test\r\n250 PIPELINING\r\n');
        else if (verb === 'HELO') socket.write('250 test\r\n');
        else if (verb === 'MAIL') socket.write('250 2.1.0 ok\r\n');
        else if (verb === 'RCPT') {
          const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (address.startsWith('gone')) socket.write(`550 5.1.1 <${address}>: Recipient address rejected: User unknown\r\n`);
          else { current.recipients.push(address); socket.write('250 2.1.5 ok\r\n'); }
        } else if (verb === 'DATA') {
          if (current.recipients.length === 0) socket.write('554 5.5.1 no valid recipients\r\n');
          else { inData = true; socket.write('354 go ahead\r\n'); }
        }
        else if (verb === 'QUIT') { socket.end('221 bye\r\n'); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as net.AddressInfo;
  return { port, taken, close: () => { server.close(); } };
}

let deployed: DeployedChannel[] = [];
let mailServer: Awaited<ReturnType<typeof startRefusingSmtpServer>> | null = null;

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  mailServer?.close();
  mailServer = null;
  clearChannelRegistry();
});

async function deployMail(id: string, to: string, queueMode: 'NEVER' | 'ON_FAILURE' | 'ALWAYS'): Promise<DeployedChannel> {
  const CH = `00000000-0000-0000-0000-${id}`;
  const channel = await deployChannel({
    channelId: CH,
    dataType: 'RAW',
    source: new ChannelReceiver({ channelId: CH }),
    destinations: [{
      metaDataId: 1, name: 'Mail', queueMode, retryIntervalMs: 50,
      connector: new SmtpDispatcher({
        host: '127.0.0.1', port: mailServer?.port ?? 0, secure: false, requireTLS: false,
        from: 'engine@example.com', to, cc: '', bcc: '',
        subject: 'Result', bodyTemplate: '${msg}', contentType: 'text/plain', attachContent: false,
      }),
    }],
  });
  deployed.push(channel);
  await getChannelDispatcher(CH)?.({ content: 'K+ 4.1', sourceMap: {} });
  return channel;
}

const statusOf = (channel: DeployedChannel): string | undefined => channel.store.connectorMessages.find((m) => m.metaDataId === 1)?.status;

describe('an SMTP destination whose mail server refuses one of two recipients (#414)', () => {
  it.each([
    ['sent at once, queuing on failure', 'smtppartly01', 'ON_FAILURE'],
    ['sent from the queue', 'smtppartly02', 'ALWAYS'],
  ] as const)('reads ERROR when %s, is not sent again, and keeps who got it', async (_how, id, queueMode) => {
    mailServer = await startRefusingSmtpServer();

    const channel = await deployMail(id, 'ward@example.com, gone@example.com', queueMode);
    await vi.waitFor(() => { expect(statusOf(channel)).toBe('ERROR'); }, { timeout: 10_000, interval: 10 });

    expect(channel.store.contentOf(1, 1, CONTENT_TYPE.RESPONSE)).toContain('accepted=ward@example.com, rejected=gone@example.com');
    const reason = channel.store.contentOf(1, 1, CONTENT_TYPE.ERROR) ?? '';
    expect(reason).toContain('refused 1 of 2 recipients');
    expect(reason).not.toContain('@');
    expect(mailServer.taken.map((mail) => mail.recipients)).toEqual([['ward@example.com']]);
  });

  it('names nobody in the error when the server refused every recipient, quoting the address in its reply', async () => {
    mailServer = await startRefusingSmtpServer();

    const channel = await deployMail('smtpnobody01', 'gone@example.com, gone2@example.com', 'NEVER');

    expect(statusOf(channel)).toBe('ERROR');
    expect(channel.store.contentOf(1, 1, CONTENT_TYPE.ERROR)).toBe('The mail server refused all 2 recipients; the response names each');
    expect(channel.store.contentOf(1, 1, CONTENT_TYPE.RESPONSE)).toContain('rejected=gone@example.com, gone2@example.com');
    expect(mailServer.taken).toEqual([]);
  });
});
