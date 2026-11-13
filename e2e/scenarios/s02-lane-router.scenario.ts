// S02: listener fans out to lane channels through queued Channel Writers.
// Production pattern: "10000 HL7 LISTENER" -> "HL7 ROUTER - Orders/Priors/
// Priority". The transformer picks a lane with destinationSet.removeAllExcept;
// ADT is ACKed but routed nowhere. Imported as a server backup, so the Channel
// Writers point at the lane channels by their Mirth channel ids.

import { expect } from '@playwright/test';
import { serverBackup, tcpListener, channelReader, channelWriter, jsWriter, type ChannelSpec } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16602;
const LANES = ['Orders', 'Priors', 'Priority'] as const;

function lane(name: string, slot: number): ChannelSpec {
  return {
    id: mirthId(2, slot),
    name: `S02 HL7 ROUTER - ${name}`,
    source: { name: 'sourceConnector', ...channelReader(), inbound: 'HL7V2' },
    destinations: [{ name: 'Route', ...jsWriter('// routed') }],
  };
}

const listener: ChannelSpec = {
  id: mirthId(2, 9),
  name: 'S02 HL7 Listener',
  source: {
    name: 'sourceConnector',
    ...tcpListener(PORT),
    inbound: 'HL7V2',
    steps: [{
      name: 'Pick lane',
      script: [
        "var type = msg.get('MSH.9.1');",
        "if (type == 'ADT') {",
        '  destinationSet.removeAll();',
        "} else if (type == 'ORU') {",
        "  destinationSet.removeAllExcept(['Priors']);",
        "} else if (msg.get('MSH.11') == 'S') {",
        "  destinationSet.removeAllExcept(['Priority']);",
        '} else {',
        "  destinationSet.removeAllExcept(['Orders']);",
        '}',
      ].join('\n'),
    }],
  },
  destinations: LANES.map((l, i) => ({
    name: l,
    ...channelWriter(mirthId(2, i + 1), { enabled: true, threadCount: 5, threadAssignmentVariable: 'threadAssignmentVar' }),
  })),
};

const msg = (type: string, ctl: string, processing = 'P'): string => [
  `MSH|^~\\&|RIS|SITE1|VNS|VNS|20261110120000||${type}|${ctl}|${processing}|2.3`,
  'PID|||MRN002^^^SITE1||ROE^RICHARD',
].join('\r');

scenario('S02 lane router sends each message type to exactly one lane channel', async (api) => {
  const ids = await api.importAndDeploy(
    serverBackup([...LANES.map((l, i) => lane(l, i + 1)), listener]),
    [...LANES.map((l) => `S02 HL7 ROUTER - ${l}`), 'S02 HL7 Listener'],
  );

  for (const [m, ctl] of [[msg('ORM^O01', 'S02A'), 'S02A'], [msg('ORU^R01', 'S02B'), 'S02B'], [msg('ADT^A08', 'S02C'), 'S02C']] as const) {
    expect(await sendMllp(PORT, m)).toContain(`MSA|AA|${ctl}`);
  }

  const count = async (l: string): Promise<number> => (await api.messages(ids[`S02 HL7 ROUTER - ${l}`]!)).total;
  await expect.poll(() => count('Orders'), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => count('Priors'), { timeout: 15_000 }).toBe(1);
  expect(await count('Priority')).toBe(0);
  expect((await api.messages(ids['S02 HL7 Listener']!)).total).toBe(3);
});
