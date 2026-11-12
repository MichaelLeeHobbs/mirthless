// S21: a file holding several HL7 messages is split into one message each.
// Gap: batch processing exists in the engine but no channel setting reaches it
// (ROADMAP). Mirth: source "Process Batch" on, HL7 split by MSH segment.

import { expect } from '@playwright/test';
import { channelExport, fileReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { dropFolder, drop } from './support/files.js';
import { scenario, mirthId } from './support/scenario.js';

const SINK = 16671;

const msg = (n: number): string => `MSH|^~\\&|LAB|S21|VNS|V|20261110120000||ORU^R01|S21-${String(n)}|P|2.5\rPID|||MRN21${String(n)}\rOBX|1|NM|GLU||${String(90 + n)}`;

scenario('S21 HL7 batch file is split into one message per MSH', async (api) => {
  const dir = dropFolder('s21');
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    const ids = await api.importAndDeploy(channelExport({
      id: mirthId(21),
      name: 'S21 Lab Batch',
      source: {
        name: 'sourceConnector',
        ...fileReader({ host: dir, fileFilter: '*.hl7', moveToDirectory: `${dir}/done`, processBatch: true }),
        inbound: 'HL7V2',
        batchSplitType: 'MSH_Segment',
      },
      destinations: [{ name: 'LIS', ...tcpSender('127.0.0.1', String(SINK)) }],
    }), ['S21 Lab Batch']);

    drop(dir, 'batch.hl7', [msg(1), msg(2), msg(3)].join('\r'));
    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(3);
    expect(sink.received.map((m) => /\|S21-(\d)\|/.exec(m)?.[1])).toEqual(['1', '2', '3']);
    expect((await api.messages(ids['S21 Lab Batch']!)).total).toBe(3);
  } finally {
    await sink.close();
  }
});
