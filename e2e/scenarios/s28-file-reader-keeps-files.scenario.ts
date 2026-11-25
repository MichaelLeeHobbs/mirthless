// Issue #178: the import dropped Mirth's "After Processing Action", and the File
// source deletes by default, so files another system expects to stay were lost.
// Mirth's "None" leaves the file, so every poll reads it again; "Move" moves it.

import { expect } from '@playwright/test';
import { channelExport, fileReader, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { dropFolder, drop, exists } from './support/files.js';
import { scenario, mirthId } from './support/scenario.js';

const KEEP_SINK = 16678;
const MOVE_SINK = 16679;

const order = (n: number): string => `MSH|^~\\&|LAB|S28|HUB|V|20261115120000||ORM^O01|S28-${String(n)}|P|2.3\rORC|NW|ACC028${String(n)}`;

scenario('S28 File Reader leaves or moves the files it reads as Mirth did', async (api) => {
  const keepDir = dropFolder('s28-keep');
  const moveDir = dropFolder('s28-move');
  const keepSink = new MllpSink(KEEP_SINK);
  const moveSink = new MllpSink(MOVE_SINK);
  await keepSink.listen();
  await moveSink.listen();
  let keepId: string | undefined;
  try {
    const ids = await api.importAndDeploy(channelExport({
      id: mirthId(28),
      name: 'S28 Shared Drop',
      source: {
        name: 'sourceConnector',
        ...fileReader({ host: keepDir, fileFilter: '*.hl7', afterProcessingAction: 'NONE' }),
        inbound: 'HL7V2',
      },
      destinations: [{ name: 'RIS', ...tcpSender('127.0.0.1', String(KEEP_SINK)) }],
    }), ['S28 Shared Drop']);
    keepId = ids['S28 Shared Drop'];
    await api.importAndDeploy(channelExport({
      id: mirthId(28, 2),
      name: 'S28 Archive Drop',
      source: {
        name: 'sourceConnector',
        ...fileReader({ host: moveDir, fileFilter: '*.hl7', moveToDirectory: `${moveDir}/done` }),
        inbound: 'HL7V2',
      },
      destinations: [{ name: 'RIS', ...tcpSender('127.0.0.1', String(MOVE_SINK)) }],
    }), ['S28 Archive Drop']);

    drop(keepDir, 'order1.hl7', order(1));
    drop(moveDir, 'order2.hl7', order(2));

    // A second receipt means a later poll found the file again, so a delete after the first can't pass.
    await expect.poll(() => keepSink.received.length).toBeGreaterThanOrEqual(2);
    expect(keepSink.received[0]).toContain('ORC|NW|ACC0281');
    expect(exists(keepDir, 'order1.hl7')).toBe(true);

    await expect.poll(() => moveSink.received.length).toBe(1);
    expect(moveSink.received[0]).toContain('ORC|NW|ACC0282');
    await expect.poll(() => exists(`${moveDir}/done`, 'order2.hl7')).toBe(true);
    expect(exists(moveDir, 'order2.hl7')).toBe(false);
  } finally {
    // The kept file is read again on every poll, as in Mirth; stop the channel before its sink goes.
    if (keepId !== undefined) await api.undeploy(keepId);
    await keepSink.close();
    await moveSink.close();
  }
});
