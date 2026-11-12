// S22: a transformer reformats dates with Mirth's DateUtil.
// Gap doc 13 N9 (JS API breadth). DateUtil.convertDate and getCurrentDate are
// the userutil calls Mirth transformers use for HL7 date handling.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16622;
const SINK = 16672;

scenario('S22 DateUtil converts an HL7 date and formats today', async (api) => {
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(22),
      name: 'S22 Date Formatting',
      source: {
        name: 'sourceConnector',
        ...tcpListener(PORT),
        inbound: 'HL7V2',
        steps: [{
          name: 'Dates',
          script: [
            "var dob = String(connectorMessage.getRawData()).split('PID|||MRN22||DOE^JO||')[1].split('|')[0];",
            "channelMap.put('dob', DateUtil.convertDate('yyyyMMdd', 'MM/dd/yyyy', dob));",
            "channelMap.put('today', DateUtil.getCurrentDate('yyyyMMdd'));",
          ].join('\n'),
        }],
      },
      destinations: [{ name: 'Out', ...tcpSender('127.0.0.1', String(SINK), undefined, 'MSH|^~\\&|VNS|S22|X|X|20261110||ZDT^Z01|S22|P|2.5\rZDT|${dob}|${today}') }],
    }), ['S22 Date Formatting']);

    await sendMllp(PORT, 'MSH|^~\\&|EHR|S22|VNS|V|20261110120000||ADT^A04|S22|P|2.5\rPID|||MRN22||DOE^JO||19700315|F');
    await expect.poll(() => sink.received.length, { timeout: 15_000 }).toBe(1);
    const d = new Date();
    const today = `${String(d.getFullYear())}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    expect(sink.received[0]).toContain(`ZDT|03/15/1970|${today}`);
  } finally {
    await sink.close();
  }
});
