// S03: transformer reads and edits HL7 through Mirth's E4X msg object.
// Production pattern: Gov "Message Router". It reads a custom ZBD envelope
// segment, stores values in the channel map, edits a field and deletes the
// segment before sending on with ${message.encodedData}.

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

scenario('S03 E4X transformer edits HL7 fields and deletes a segment', async (api) => {
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
            "var target = msg['ZBD']['ZBD.1']['ZBD.1.1'].toString();",
            "channelMap.put('target', target);",
            "channelMap.put('accession', msg['ZBD']['ZBD.2']['ZBD.2.1'].toString());",
            "$c('institution', msg['MSH']['MSH.4']['MSH.4.1'].toString());",
            "msg['PID']['PID.5']['PID.5.1'] = msg['PID']['PID.5']['PID.5.1'].toString().toUpperCase();",
            "delete msg['ZBD'];",
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
