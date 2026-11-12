// S01: MLLP listener whose ACK comes from the postprocessor.
// Production pattern: "10000 HL7 LISTENER". The source transformer builds the
// ACK into the channel map and the postprocessor returns it as the response.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16601;
const NAME = 'S01 HL7 Listener';

const ORM = [
  'MSH|^~\\&|RIS|SITE1|VNS|VNS|20261110120000||ORM^O01|CTL0001|P|2.3',
  'PID|||MRN001^^^SITE1||DOE^JANE||19700101|F',
  'ORC|NW|ACC001',
  'OBR|1|ACC001||71020^CHEST 2V',
].join('\r');

scenario('S01 MLLP listener returns the ACK its postprocessor builds', async (api) => {
  await api.importAndDeploy(channelExport({
    id: mirthId(1),
    name: NAME,
    source: {
      name: 'sourceConnector',
      ...tcpListener(PORT, { responseVariable: 'Postprocessor' }),
      inbound: 'HL7V2',
      steps: [{
        name: 'Build ACK',
        script: [
          'var raw = String(connectorMessage.getRawData());',
          "var msh = raw.split('\\r')[0].split('|');",
          "var ack = 'MSH|^~\\\\&|VNS|VNS|' + msh[2] + '|' + msh[3] + '|20261110120001||ACK|' + msh[9] + '|P|' + msh[11] + '\\r' + 'MSA|AA|' + msh[9] + '|Accepted by S01';",
          "channelMap.put('ack', ack);",
        ].join('\n'),
      }],
    },
    destinations: [{ name: 'Store', ...jsWriter('// nothing to send') }],
    preprocessor: "return String(message).replace(/[\\x00-\\x08]/g, '');",
    postprocessor: "return $c('ack');",
  }), [NAME]);

  const ack = await sendMllp(PORT, ORM);
  expect(ack).toContain('MSH|^~\\&|VNS|VNS|RIS|SITE1|');
  expect(ack).toContain('MSA|AA|CTL0001|Accepted by S01');
});
