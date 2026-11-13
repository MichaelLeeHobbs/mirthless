// S23: a destination error sends an alert email.
// Operator expectation (doc 14 B1 and Mirth Alerts): an error on a channel
// mails the on-call address with the channel name. The alert is set up in this
// product's own alert screen (API), since alerts are server settings an
// operator recreates rather than channel exports.
// Needs GreenMail: docker compose -f docker/docker-compose.yml --profile test up -d mail-test

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId, MAIL, mailSubjects } from './support/scenario.js';

const PORT = 16623;
const NAME = 'S23 Failing Interface';

scenario('S23 destination error triggers an alert email naming the channel', async (api) => {
  await api.put('/settings/smtp.host', { key: 'smtp.host', value: '127.0.0.1', category: 'smtp' });
  await api.put('/settings/smtp.port', { key: 'smtp.port', value: String(MAIL.smtpPort), type: 'number', category: 'smtp' });
  await api.put('/settings/smtp.secure', { key: 'smtp.secure', value: 'false', type: 'boolean', category: 'smtp' });
  await api.put('/settings/smtp.from', { key: 'smtp.from', value: 'galvaniflow@example.com', category: 'smtp' });

  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(23),
    name: NAME,
    source: { name: 'sourceConnector', ...tcpListener(PORT), inbound: 'HL7V2' },
    destinations: [{ name: 'Broken API', ...jsWriter("throw 'downstream unavailable';") }],
  }), [NAME]);

  await api.post('/alerts', {
    name: 'S23 errors',
    trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'] },
    channelIds: [ids[NAME]],
    actions: [{ type: 'EMAIL', recipients: [MAIL.address] }],
    subjectTemplate: 'ALERT ${channelName}',
  });
  // Alerts load at deploy; redeploy so the channel picks it up.
  await api.undeploy(ids[NAME]!);
  await api.deployAndStart(ids[NAME]!);

  await sendMllp(PORT, 'MSH|^~\\&|EHR|S23|VNS|V|20261110120000||ADT^A01|S23|P|2.5\rPID|||MRN23');
  await expect.poll(async () => (await mailSubjects(NAME)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
});
