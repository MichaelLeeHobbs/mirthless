// S20: an X12 270 eligibility request is read with the EDI/X12 data type.
// Gap doc 13 N1. Mirth serializes X12 to XML with one element per segment and
// numbered child elements, so NM1's member id is msg['NM1'][n]['NM1.09'].

import { expect } from '@playwright/test';
import { channelExport, fileReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { dropFolder, drop } from './support/files.js';
import { scenario, mirthId } from './support/scenario.js';

const SINK = 16670;

const X12_270 = [
  'ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *261110*1200*^*00501*000000020*0*P*:~',
  'GS*HS*SUBMITTER*RECEIVER*20261110*1200*20*X*005010X279A1~',
  'ST*270*0020*005010X279A1~',
  'BHT*0022*13*S20REQ*20261110*1200~',
  'HL*1**20*1~',
  'NM1*PR*2*ACME HEALTH*****PI*12345~',
  'HL*2*1*21*1~',
  'NM1*1P*2*VNS IMAGING*****XX*1234567893~',
  'HL*3*2*22*0~',
  'NM1*IL*1*DOE*JANE****MI*MEMBER123~',
  'EQ*30~',
  'SE*10*0020~',
  'GE*1*20~',
  'IEA*1*000000020~',
].join('');

scenario('S20 X12 270 member id is read through msg', async (api) => {
  const dir = dropFolder('s20');
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(20),
      name: 'S20 Eligibility',
      source: {
        name: 'sourceConnector',
        ...fileReader({ host: dir, fileFilter: '*.x12', moveToDirectory: `${dir}/done` }),
        inbound: 'EDI/X12',
        outbound: 'HL7V2',
        steps: [{
          name: 'Member',
          script: [
            "var member = msg['NM1'][2]['NM1.09'].toString();",
            "channelMap.put('out', 'MSH|^~\\\\&|X12|S20|VNS|V|20261110120000||ZEL^Z01|S20|P|2.5\\rZEL|' + member);",
          ].join('\n'),
        }],
      },
      destinations: [{ name: 'Eligibility', ...tcpSender('127.0.0.1', String(SINK), undefined, '${out}') }],
    }), ['S20 Eligibility']);

    drop(dir, 'request.x12', X12_270);
    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(1);
    expect(sink.received[0]).toContain('ZEL|MEMBER123');
  } finally {
    await sink.close();
  }
});
