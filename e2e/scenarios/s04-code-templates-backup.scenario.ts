// S04: channel logic lives in code templates that come with a server backup.
// Production pattern: 87 templates in 15 libraries; channel steps are one line
// such as `msg = hl7ReportProcessorDHA(msg)`. Templates use global `var`
// namespaces plus const and arrow functions, which Mirth's Rhino accepts.

import { expect } from '@playwright/test';
import { serverBackup, tcpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16604;
const SINK = 16654;
const CHANNEL_ID = mirthId(4);

const SITE_CODES = [
  'var siteCodes = {',
  "  lookup: function (code) { return { SITE4: 'NORTH', SITE5: 'SOUTH' }[code] || 'UNKNOWN'; }",
  '};',
].join('\n');

const STAMP_SITE = [
  '/** Stamp the sending facility with its region. */',
  'function stampSite(raw) {',
  "  const segments = String(raw).split('\\r');",
  '  return segments.map((s) => {',
  "    if (s.indexOf('MSH|') !== 0) return s;",
  "    const f = s.split('|');",
  "    f[3] = f[3] + '-' + siteCodes.lookup(f[3]);",
  "    return f.join('|');",
  "  }).join('\\r');",
  '}',
].join('\n');

const ORM = [
  'MSH|^~\\&|RIS|SITE4|VNS|VNS|20261110120000||ORM^O01|S04CTL|P|2.3',
  'PID|||MRN004^^^SITE4||LEE^SAM',
].join('\r');

scenario('S04 channel calls code templates imported with the server backup', async (api) => {
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(serverBackup(
      [{
        id: CHANNEL_ID,
        name: 'S04 Report Processor',
        source: {
          name: 'sourceConnector',
          ...tcpListener(PORT),
          inbound: 'RAW',
          steps: [{ name: 'Stamp', script: 'msg = stampSite(msg);' }],
        },
        destinations: [{ name: 'Report Sender', ...tcpSender('127.0.0.1', String(SINK)) }],
      }],
      [{
        id: '5c0004aa-0000-4000-8000-000000000001',
        name: 'Globals',
        enabledChannelIds: [CHANNEL_ID],
        templates: [
          { id: '5c0004aa-0000-4000-8000-000000000002', name: 'siteCodes', code: SITE_CODES },
          { id: '5c0004aa-0000-4000-8000-000000000003', name: 'stampSite', code: STAMP_SITE },
        ],
      }],
    ), ['S04 Report Processor']);

    await sendMllp(PORT, ORM);
    await expect.poll(() => sink.received.length, { timeout: 15_000 }).toBe(1);
    expect(sink.received[0]).toContain('MSH|^~\\&|RIS|SITE4-NORTH|VNS|');
  } finally {
    await sink.close();
  }
});
