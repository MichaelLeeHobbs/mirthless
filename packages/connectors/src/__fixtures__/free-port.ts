import * as net from 'node:net';

const given = new Set<number>();

/**
 * A port nothing listens on, for a config that needs one before it listens, and a different
 * one each time. A fixed one fails when another checkout runs the same test at the same time (#376).
 */
export async function freePort(): Promise<number> {
  const held: net.Server[] = [];
  let port: number;
  do {
    const server = net.createServer();
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    held.push(server);
    port = (server.address() as net.AddressInfo).port;
    // While the ones tried are held, the system gives another.
  } while (given.has(port));
  given.add(port);
  await Promise.all(held.map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); })));
  return port;
}
