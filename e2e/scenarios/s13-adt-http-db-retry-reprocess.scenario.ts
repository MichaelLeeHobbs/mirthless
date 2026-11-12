// S13: the reference job from the climb brief.
// An HL7 ADT arrives over MLLP. A filter drops A08s. A transformer maps PID-5
// to JSON, which goes to an HTTP endpoint and a Postgres table. A failed HTTP
// send queues and retries. The message browser shows the error and reprocess
// succeeds.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, httpSender, dbWriter } from './support/mirth-xml.js';
import { HttpSink, sendMllp } from './support/net.js';
import { jdbcUrl, dbUser, sql } from './support/db.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16613;
const API_PORT = 16663;

const adt = (event: string, ctl: string, family: string): string => [
  `MSH|^~\\&|EHR|SITE13|VNS|VNS|20261110120000||ADT^${event}|${ctl}|P|2.5`,
  `EVN|${event}|20261110120000`,
  `PID|||MRN${ctl}^^^SITE13||${family}^PAT||19900101|F`,
].join('\r');

scenario('S13 ADT is filtered, mapped to JSON, sent to HTTP and Postgres, retried, then reprocessed', async (api) => {
  await sql('DROP TABLE IF EXISTS partner.s13_patients');
  await sql('CREATE TABLE partner.s13_patients (mrn text NOT NULL, family text NOT NULL)');
  const sink = new HttpSink(API_PORT);
  sink.status = 500;
  await sink.listen();
  try {
    const ids = await api.importAndDeploy(channelExport({
      id: mirthId(13),
      name: 'S13 ADT Feed',
      source: {
        name: 'sourceConnector',
        ...tcpListener(PORT),
        inbound: 'HL7V2',
        rules: [{ name: 'Drop A08', script: "return msg.get('MSH.9.2') != 'A08';" }],
        steps: [{
          name: 'PID-5 to JSON',
          script: [
            'var patient = {',
            "  mrn: msg.get('PID.3.1'),",
            "  family: msg.get('PID.5.1'),",
            "  given: msg.get('PID.5.2')",
            '};',
            "$c('patientJson', JSON.stringify(patient));",
            "$c('mrn', patient.mrn);",
            "$c('family', patient.family);",
          ].join('\n'),
        }],
      },
      destinations: [
        { name: 'Patient API', ...httpSender(`http://127.0.0.1:${String(API_PORT)}/patients`, { enabled: true, retryIntervalMillis: 1000 }, { content: '${patientJson}' }) },
        { name: 'Patient table', ...dbWriter({ driver: 'org.postgresql.Driver', url: jdbcUrl(), ...dbUser() }, 'INSERT INTO partner.s13_patients (mrn, family) VALUES (${mrn}, ${family})') },
      ],
    }), ['S13 ADT Feed']);
    const channelId = ids['S13 ADT Feed']!;

    expect(await sendMllp(PORT, adt('A08', 'S13X', 'IGNORED'))).toContain('MSA|AA|S13X');
    expect(await sendMllp(PORT, adt('A01', 'S13A', 'GARCIA'))).toContain('MSA|AA|S13A');

    // The A01 is in the table; the HTTP send failed and is queued, with its error visible.
    await expect.poll(async () => (await sql('SELECT mrn, family FROM partner.s13_patients')).length, { timeout: 15_000 }).toBe(1);
    expect(await sql('SELECT mrn, family FROM partner.s13_patients')).toEqual([{ mrn: 'MRNS13A', family: 'GARCIA' }]);
    const a01 = async () => {
      const list = await api.messages(channelId);
      const m = list.items.find((i) => i.connectors.some((c) => c.metaDataId === 1));
      return m ? api.message(channelId, m.messageId) : null;
    };
    await expect.poll(async () => (await a01())?.connectors.find((c) => c.metaDataId === 1)?.status, { timeout: 15_000 }).toBe('QUEUED');
    // The queue makes the first attempt shortly after the message is queued.
    await expect.poll(async () => (await a01())?.connectors.find((c) => c.metaDataId === 1)?.content['error'] ?? '', { timeout: 15_000 }).toContain('500');

    // The API recovers: the queue retries and delivers the JSON once.
    sink.status = 200;
    await expect.poll(async () => (await a01())?.connectors.find((c) => c.metaDataId === 1)?.status, { timeout: 20_000 }).toBe('SENT');
    expect(sink.requests.filter((r) => r.method === 'POST').length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(sink.requests.at(-1)!.body)).toEqual({ mrn: 'MRNS13A', family: 'GARCIA', given: 'PAT' });
    expect(sink.requests.some((r) => r.body.includes('IGNORED'))).toBe(false);

    // Reprocess from the message browser: delivered again to both destinations.
    const before = sink.requests.length;
    await api.post(`/channels/${channelId}/messages/${String((await a01())!.messageId)}/reprocess`);
    await expect.poll(() => sink.requests.length, { timeout: 15_000 }).toBe(before + 1);
    await expect.poll(async () => (await sql('SELECT mrn FROM partner.s13_patients')).length, { timeout: 15_000 }).toBe(2);
  } finally {
    await sink.close();
  }
});
