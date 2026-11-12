// S19: a CSV file is read with the Delimited data type and mapped through msg.
// Gap doc 13 N2: Mirth serializes delimited text to XML, so a transformer reads
// msg['row']['column'] by the configured column names.

import { expect } from '@playwright/test';
import { channelExport, fileReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { dropFolder, drop } from './support/files.js';
import { scenario, mirthId } from './support/scenario.js';

const SINK = 16669;

scenario('S19 Delimited CSV rows are mapped by column name', async (api) => {
  const dir = dropFolder('s19');
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(19),
      name: 'S19 Census CSV',
      source: {
        name: 'sourceConnector',
        ...fileReader({ host: dir, fileFilter: '*.csv', moveToDirectory: `${dir}/done` }),
        inbound: 'DELIMITED',
        outbound: 'HL7V2',
        delimited: { columnDelimiter: ',', columnNames: 'mrn,family,given' },
        steps: [{
          name: 'Row to PID',
          script: [
            "var mrn = msg['row']['mrn'].toString();",
            "var name = msg['row']['family'].toString() + '^' + msg['row']['given'].toString();",
            "channelMap.put('hl7', 'MSH|^~\\\\&|CSV|S19|VNS|V|20261110120000||ADT^A04|' + mrn + '|P|2.5\\rPID|||' + mrn + '||' + name);",
          ].join('\n'),
        }],
      },
      destinations: [{ name: 'ADT', ...tcpSender('127.0.0.1', String(SINK), undefined, '${hl7}') }],
    }), ['S19 Census CSV']);

    drop(dir, 'census.csv', 'MRN19,DOE,JOHN\n');
    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(1);
    expect(sink.received[0]).toContain('PID|||MRN19||DOE^JOHN');
  } finally {
    await sink.close();
  }
});
