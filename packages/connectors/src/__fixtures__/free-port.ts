import * as net from 'node:net';

/**
 * A port nothing listens on, for a config that needs one before it listens. A fixed one fails
 * when another checkout runs the same test at the same time (#376).
 */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  return port;
}
