// S16: a File Reader with the SFTP scheme picks up files from a partner server.
// Gap doc 12 rank 2: Mirth exports remote file channels as a File Reader with
// scheme SFTP (or FTP/SMB/S3). Needs the SFTP container:
// docker compose -f docker/docker-compose.yml --profile test up -d sftp-test

import { expect } from '@playwright/test';
import { channelExport, fileReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { scenario, mirthId, SFTP, withSftp } from './support/scenario.js';

const SINK = 16666;
const DIR = `${SFTP.base}/s16`;

scenario('S16 File Reader over SFTP reads a partner file and deletes it', async (api) => {
  await withSftp(async (c) => {
    if (await c.exists(DIR)) await c.rmdir(DIR, true);
    await c.mkdir(DIR, true);
  });
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(16),
      name: 'S16 SFTP Orders',
      source: {
        name: 'sourceConnector',
        ...fileReader({ scheme: 'SFTP', host: `${SFTP.host}:${String(SFTP.port)}${DIR}`, fileFilter: '*.hl7', username: SFTP.username, password: SFTP.password }),
        inbound: 'HL7V2',
      },
      destinations: [{ name: 'RIS', ...tcpSender('127.0.0.1', String(SINK)) }],
    }), ['S16 SFTP Orders']);

    await withSftp((c) => c.put(Buffer.from('MSH|^~\\&|LAB|S16|VNS|V|20261110120000||ORM^O01|S16CTL|P|2.3\rORC|NW|ACC016'), `${DIR}/order1.hl7`));
    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(1);
    expect(sink.received[0]).toContain('ORC|NW|ACC016');
    await expect.poll(() => withSftp((c) => c.exists(`${DIR}/order1.hl7`)), { timeout: 10_000 }).toBe(false);
  } finally {
    await sink.close();
  }
});
