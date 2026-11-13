// ===========================================
// Scenario suite: the systems on the other end
// ===========================================
// Real sockets standing in for the partner systems a channel talks to: an HL7
// sender, an MLLP receiver that ACKs (or refuses, or is down), and an HTTP API.

import * as net from 'node:net';
import * as http from 'node:http';

const VT = '\x0b';
const FS_CR = '\x1c\r';

/** Send one framed message and resolve with the reply between the frame bytes. */
export function sendFramed(port: number, message: string, start = VT, end = FS_CR, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => { client.write(start + message + end); });
    let buf = '';
    const timer = setTimeout(() => { client.destroy(); reject(new Error(`no reply from port ${String(port)} in ${String(timeoutMs)}ms`)); }, timeoutMs);
    client.setEncoding('utf8');
    client.on('data', (chunk: string) => {
      buf += chunk;
      const s = buf.indexOf(start);
      const e = buf.indexOf(end, s + start.length);
      if (s !== -1 && e !== -1) {
        clearTimeout(timer);
        client.end();
        resolve(buf.slice(s + start.length, e));
      }
    });
    client.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Send an MLLP message and return the ACK. */
export const sendMllp = (port: number, message: string): Promise<string> => sendFramed(port, message);

/** Build an HL7 ACK for a received message. */
export function ackFor(message: string, code: 'AA' | 'AE' | 'AR', text = ''): string {
  const msh = message.split('\r')[0] ?? '';
  const f = msh.split('|');
  const control = f[9] ?? '';
  return [`MSH|^~\\&|${f[4] ?? ''}|${f[5] ?? ''}|${f[2] ?? ''}|${f[3] ?? ''}|20260101000000||ACK|ACK${control}|P|${f[11] ?? '2.5'}`, `MSA|${code}|${control}|${text}`].join('\r');
}

/** An MLLP partner that records what it receives and replies with an ACK. */
export class MllpSink {
  readonly received: string[] = [];
  ackCode: 'AA' | 'AE' | 'AR' = 'AA';
  private server: net.Server | null = null;

  constructor(readonly port: number, private readonly start = VT, private readonly end = FS_CR) {}

  private readonly sockets = new Set<net.Socket>();

  async listen(): Promise<void> {
    this.server = net.createServer((sock) => {
      this.sockets.add(sock);
      sock.on('close', () => this.sockets.delete(sock));
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (chunk: string) => {
        buf += chunk;
        for (;;) {
          const s = buf.indexOf(this.start);
          const e = buf.indexOf(this.end, s + 1);
          if (s === -1 || e === -1) break;
          const msg = buf.slice(s + this.start.length, e);
          buf = buf.slice(e + this.end.length);
          this.received.push(msg);
          sock.write(this.start + ackFor(msg, this.ackCode) + this.end);
        }
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    // Senders may hold their connection open; drop them so close() returns.
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** An HTTP partner API. `status` sets what it answers; it records every request. */
export class HttpSink {
  readonly requests: RecordedRequest[] = [];
  status = 200;
  responseBody = '{"ok":true}';
  private server: http.Server | null = null;

  constructor(readonly port: number) {}

  async listen(): Promise<void> {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c: string) => { body += c; });
      req.on('end', () => {
        this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        res.writeHead(this.status, { 'Content-Type': 'application/json' });
        res.end(this.responseBody);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
