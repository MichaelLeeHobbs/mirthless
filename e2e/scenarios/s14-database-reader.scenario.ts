// S14: a Database Reader polls a Postgres table and marks rows it has read.
// Gap doc 12 (Database connector). The select/update pair is Mirth's
// "run update statement after each message" mode; ${id} in the update refers to
// the current row's column. Mirth hands the row to scripts as XML; GalvaniFlow
// reads rows as JSON objects, so the export keeps Mirth's XML data type and the
// rewritten script reads msg.accession.

import { expect } from '@playwright/test';
import { channelExport, dbReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { jdbcUrl, dbUser, sql } from './support/db.js';
import { scenario, mirthId } from './support/scenario.js';

const SINK = 16664;

scenario('S14 Database Reader turns new rows into HL7 and marks them sent', async (api) => {
  await sql('DROP TABLE IF EXISTS partner.s14_orders');
  await sql("CREATE TABLE partner.s14_orders (id serial PRIMARY KEY, accession text NOT NULL, status text NOT NULL DEFAULT 'NEW')");
  await sql("INSERT INTO partner.s14_orders (accession) VALUES ('ACC-S14-1'), ('ACC-S14-2')");
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(14),
      name: 'S14 Order Poller',
      source: {
        name: 'sourceConnector',
        ...dbReader({ driver: 'org.postgresql.Driver', url: jdbcUrl(), ...dbUser() },
          "SELECT id, accession FROM partner.s14_orders WHERE status = 'NEW' ORDER BY id",
          "UPDATE partner.s14_orders SET status = 'SENT' WHERE id = ${id}"),
        inbound: 'XML',
        steps: [{
          name: 'To ORM',
          script: "$c('hl7', 'MSH|^~\\\\&|DB|S14|VNS|VNS|20261110120000||ORM^O01|' + msg.accession + '|P|2.3\\rORC|NW|' + msg.accession);",
        }],
      },
      destinations: [{ name: 'RIS', ...tcpSender('127.0.0.1', String(SINK), undefined, '${hl7}') }],
    }), ['S14 Order Poller']);

    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(2);
    expect(sink.received.map((m) => m.split('ORC|NW|')[1])).toEqual(['ACC-S14-1', 'ACC-S14-2']);
    await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM partner.s14_orders ORDER BY id')).map((r) => r.status), { timeout: 10_000 })
      .toEqual(['SENT', 'SENT']);
  } finally {
    await sink.close();
  }
});
