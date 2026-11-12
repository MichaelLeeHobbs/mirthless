// S12: an SMTP Sender mails a notice whose subject comes from the channel map.
// Production pattern: Gov "SendMail" (SMTP Sender, subject ${subject}).
// Needs GreenMail: docker compose -f docker/docker-compose.yml --profile test up -d mail-test

import { expect } from '@playwright/test';
import { channelExport, tcpListener, smtpSender } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId, MAIL, mailSubjects } from './support/scenario.js';

const PORT = 16612;

scenario('S12 SMTP Sender sends a mail with a subject from the channel map', async (api) => {
  const stamp = String(Date.now());
  await api.importAndDeploy(channelExport({
    id: mirthId(12),
    name: 'S12 SendMail',
    source: {
      name: 'sourceConnector',
      ...tcpListener(PORT),
      inbound: 'HL7V2',
      steps: [{
        name: 'Subject',
        script: "$c('subject', 'S12 report ' + msg.get('ORC.2'));",
      }],
    },
    destinations: [{
      name: 'SES',
      ...smtpSender({ host: '127.0.0.1', port: String(MAIL.smtpPort), to: MAIL.address, from: 'vns@example.com', subject: '${subject}', body: 'Report is ready.' }),
    }],
  }), ['S12 SendMail']);

  await sendMllp(PORT, `MSH|^~\\&|RIS|S|VNS|V|20261110120000||ORM^O01|S12|P|2.3\rORC|NW|ACC${stamp}`);
  await expect.poll(() => mailSubjects(`ACC${stamp}`), { timeout: 20_000 }).toEqual([`S12 report ACC${stamp}`]);
});
