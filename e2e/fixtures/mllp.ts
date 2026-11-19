import * as net from 'node:net';

const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;

export function sendMllpMessage(port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => {
      client.write(Buffer.concat([Buffer.from([VT]), Buffer.from(message), Buffer.from([FS, CR])]));
    });
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { client.destroy(); reject(new Error('MLLP send timeout')); }, 10_000);
    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= 3 && buffer[buffer.length - 2] === FS && buffer[buffer.length - 1] === CR) {
        client.end();
        resolve(buffer.subarray(1, buffer.length - 2).toString());
      }
    });
    client.on('error', reject);
    client.on('close', () => clearTimeout(timer));
  });
}
