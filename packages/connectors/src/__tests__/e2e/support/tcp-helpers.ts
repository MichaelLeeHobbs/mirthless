import * as net from 'node:net';
import {
  wrapMllp,
  MllpParser,
  createSourceConnector,
  createDestinationConnector,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '../../../index.js';

/** Built by the connector registry as a deploy builds it, so the schema's defaults apply (#242). */
export function mllpSource(port: number, props: Readonly<Record<string, unknown>> = {}): SourceConnectorRuntime {
  return createSourceConnector('TCP_MLLP', { host: '127.0.0.1', port, ...props });
}

export function mllpDestination(port: number, props: Readonly<Record<string, unknown>> = {}): DestinationConnectorRuntime {
  return createDestinationConnector('TCP_MLLP', { host: '127.0.0.1', port, ...props });
}

export interface MllpCaptureServer {
  readonly received: readonly string[];
  readonly port: number;
  close(): void;
}

export async function startMllpCaptureServer(ackFor?: (message: string) => string): Promise<MllpCaptureServer> {
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
    server.listen(0, '127.0.0.1', () => { resolve(); });
  });

  return { received, port: (server.address() as net.AddressInfo).port, close: () => { server.close(); } };
}

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
