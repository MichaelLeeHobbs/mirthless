// S03: transformer reads and edits HL7 fields and deletes a segment.
// Production pattern: Gov "Message Router". It reads a custom ZBD envelope
// segment, stores values in the channel map, edits a field and deletes the
// segment before sending on with ${message.encodedData}. The script is the
// production one rewritten for GalvaniFlow's msg.get/set/delete (D-244).

import { expect } from '@playwright/test';
import { channelExport, tcpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16603;
const SINK = 16653;

const ORU = [
  'MSH|^~\\&|EXA|SITE3|VNS|VNS|20261110120000||ORU^R01|S03CTL|P|2.4',
  'ZBD|SITE3-SENDER^GOV|ACC003|SITE3',
  'PID|||MRN003^^^SITE3||smith^anna||19800202|F',
  'OBR|1|ACC003||71020^CHEST 2V',
  'OBX|1|TX|IMP||No acute findings',
].join('\r');

scenario('S03 transformer edits HL7 fields and deletes a segment', async (api) => {
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(3),
      name: 'S03 Message Router',
      source: {
        name: 'sourceConnector',
        ...tcpListener(PORT),
        inbound: 'HL7V2',
        steps: [{
          name: 'Read envelope',
          script: [
            "$c('target', msg.get('ZBD.1.1'));",
            "$c('accession', msg.get('ZBD.2.1'));",
            "$c('institution', msg.get('MSH.4.1'));",
            "msg.set('PID.5.1', msg.get('PID.5.1').toUpperCase());",
            "msg.delete('ZBD');",
          ].join('\n'),
        }],
      },
      destinations: [{ name: 'Gov Sender', ...tcpSender('127.0.0.1', String(SINK)) }],
    }), ['S03 Message Router']);

    expect(await sendMllp(PORT, ORU)).toContain('MSA|AA|S03CTL');
    await expect.poll(() => sink.received.length, { timeout: 15_000 }).toBe(1);
    const out = sink.received[0]!;
    expect(out).not.toContain('ZBD|');
    expect(out).toContain('PID|||MRN003^^^SITE3||SMITH^anna');
    expect(out).toContain('OBX|1|TX|IMP||No acute findings');
  } finally {
    await sink.close();
  }
});
