// An IMAP server that stops answering during the connect: no connection may be left open (#434).

import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailReceiver, EMAIL_POST_ACTION, EMAIL_PROTOCOL } from '../email-receiver.js';

/** From this step on the server says nothing. */
let hangsAt: string;
let hung: Promise<void>;
let server: Server;
const open = new Set<Socket>();

function answer(socket: Socket, line: string, onHang: () => void): void {
  const [tag, name = ''] = line.split(' ');
  if (name.toUpperCase() === hangsAt) { onHang(); return; }
  const untagged = name.toUpperCase() === 'CAPABILITY' ? '* CAPABILITY IMAP4rev1 NAMESPACE\r\n' : '';
  socket.write(`${untagged}${tag!} OK done\r\n`);
}

beforeEach(async () => {
  let onHang = (): void => undefined;
  hung = new Promise((resolve) => { onHang = resolve; });
  server = createServer((socket) => {
    open.add(socket);
    socket.on('close', () => { open.delete(socket); });
    socket.on('error', () => { /* The client drops the connection: that is the test. */ });
    let silent = false;
    socket.on('data', (data) => {
      for (const line of data.toString('latin1').split('\r\n').filter((l) => l !== '')) {
        if (!silent) answer(socket, line, () => { silent = true; onHang(); });
      }
    });
    if (hangsAt === 'GREETING') onHang();
    else socket.write('* OK ready\r\n');
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of open) socket.destroy();
  await new Promise((resolve) => { server.close(resolve); });
});

function makeReceiver(): EmailReceiver {
  const receiver = new EmailReceiver({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    secure: false,
    username: 'lab',
    password: 'secret',
    protocol: EMAIL_PROTOCOL.IMAP,
    folder: 'INBOX',
    pollingIntervalMs: 1_000,
    postAction: EMAIL_POST_ACTION.MARK_READ,
    moveToFolder: '',
    subjectFilter: '',
  });
  receiver.setDispatcher(async () => ({ ok: true as const, value: { messageId: 1 }, error: null }));
  return receiver;
}

describe('an IMAP server that stops answering during the connect', () => {
  it.each(['GREETING', 'CAPABILITY', 'LOGIN', 'NAMESPACE'])('has no connection left once the source has failed to start (%s)', async (step) => {
    hangsAt = step;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const starting = makeReceiver().onStart();
    await hung;
    expect(open.size).toBe(1);

    // The connect (the library itself gives up the greeting sooner), then the 10 s it waits
    // for the answer to a LOGOUT on a signed-in connection.
    await vi.advanceTimersByTimeAsync(30_000 + 11_000);
    const started = await starting;
    vi.useRealTimers();

    expect(started.ok).toBe(false);
    await vi.waitFor(() => { expect(open.size).toBe(0); }, { timeout: 5_000 });
  });
});
