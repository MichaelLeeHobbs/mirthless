// S05: JSON report becomes an HL7 ORU sent to a host from the configuration map.
// Production pattern: "HL7 Report Processor - <customer>" Report Sender. A
// destination transformer builds the ORU from JSON; the TCP Sender's address is
// ${MIRTH_SENDER_HOST}:${MIRTH_SENDER_PORT}, configuration map entries an
// operator adds with the same names they had in Mirth.

import { expect, request } from '@playwright/test';
import { channelExport, httpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16605;
const SINK = 16655;

scenario('S05 JSON report is sent as an ORU to the configuration-map host', async (api) => {
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.setConfig('vns', 'MIRTH_SENDER_HOST', '127.0.0.1');
    await api.setConfig('vns', 'MIRTH_SENDER_PORT', String(SINK));
    await api.importAndDeploy(channelExport({
      id: mirthId(5),
      name: 'S05 Report Processor',
      source: { name: 'sourceConnector', ...httpListener(PORT, { contentType: 'application/json' }), inbound: 'JSON' },
      destinations: [{
        name: 'Report Sender',
        ...tcpSender('${MIRTH_SENDER_HOST}', '${MIRTH_SENDER_PORT}', { enabled: true, retryIntervalMillis: 1000 }, '${oru}'),
        inbound: 'JSON',
        outbound: 'HL7V2',
        steps: [{
          name: 'reportGenerator',
          script: [
            'var r = msg;',
            "var oru = ['MSH|^~\\\\&|VNS|VNS|' + r.site + '|' + r.site + '|20261110120000||ORU^R01|' + r.accession + '|P|2.3',",
            "  'PID|||' + r.mrn,",
            "  'OBR|1|' + r.accession + '||' + r.procedure,",
            "  'OBX|1|TX|IMP||' + r.impression].join('\\r');",
            "$c('oru', oru);",
          ].join('\n'),
        }],
      }],
    }), ['S05 Report Processor']);

    const ctx = await request.newContext();
    const res = await ctx.post(`http://127.0.0.1:${String(PORT)}/`, {
      data: { site: 'SITE5', accession: 'ACC005', mrn: 'MRN005', procedure: '71020^CHEST 2V', impression: 'Normal study' },
    });
    expect(res.status()).toBe(200);
    await ctx.dispose();

    await expect.poll(() => sink.received.length, { timeout: 15_000 }).toBe(1);
    const oru = sink.received[0]!;
    expect(oru).toContain('ORU^R01|ACC005');
    expect(oru).toContain('OBX|1|TX|IMP||Normal study');
  } finally {
    await sink.close();
  }
});
