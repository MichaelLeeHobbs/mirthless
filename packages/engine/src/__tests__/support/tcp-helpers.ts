// ===========================================
// TCP/MLLP Test Helpers
// ===========================================
// Real TCP servers/clients for exercising the TCP/MLLP connectors end to end.

import * as net from 'node:net';
import { wrapMllp, MllpParser } from '@mirthless/connectors';

export interface MllpCaptureServer {
  /** Every framed message the server has received, in order. */
  readonly received: readonly string[];
  readonly port: number;
  close(): void;
}

/**
 * Start a TCP server that speaks MLLP: it records each framed message it
 * receives and replies with an ACK (customisable via `ackFor`).
 */
export async function startMllpCaptureServer(
  port: number,
  ackFor?: (message: string) => string,
): Promise<MllpCaptureServer> {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    const parser = new MllpParser();
    socket.on('data', (chunk: Buffer) => {
      for (const message of parser.parse(chunk)) {
        received.push(message);
        socket.write(wrapMllp(ackFor ? ackFor(message) : 'MSH|^~\\&|ACK|||AA'));
      }
    });
    socket.on('error', () => { /* client reset — ignore in tests */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { resolve(); });
  });

  return { received, port, close: () => { server.close(); } };
}

/** Connect, send one MLLP-framed message, and resolve with the framed reply. */
export async function sendMllp(port: number, message: string, timeoutMs = 10_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => {
      client.write(wrapMllp(message));
    });

    const parser = new MllpParser();
    client.on('data', (chunk: Buffer) => {
      const messages = parser.parse(chunk);
      const first = messages[0];
      if (first !== undefined) {
        client.end();
        resolve(first);
      }
    });

    client.on('error', reject);
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('sendMllp: timed out waiting for reply'));
    }, timeoutMs);
    timer.unref();
  });
}
