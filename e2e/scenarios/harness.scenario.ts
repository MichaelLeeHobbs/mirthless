// Harness self-checks. Not scored (no S-number).
// Each partner helper is checked against a real counterpart, and one channel is
// built natively through this product's API (no Mirth import) and must pass.
// If one of these fails, scenario failures may be harness faults, not product
// gaps: fix the harness before reading the score.

import { test, expect } from '@playwright/test';
import nodemailer from 'nodemailer';
import mysql from 'mysql2/promise';
import { Api } from './support/api.js';
import { MllpSink, HttpSink, sendMllp } from './support/net.js';
import { sql } from './support/db.js';
import { MAIL, mailSubjects, withSftp, SFTP } from './support/scenario.js';

test('HARNESS MLLP sink and sender talk to each other', async () => {
  const sink = new MllpSink(16690);
  await sink.listen();
  try {
    const ack = await sendMllp(16690, 'MSH|^~\\&|A|B|C|D|20261110||ADT^A01|H1|P|2.5');
    expect(ack).toContain('MSA|AA|H1');
    expect(sink.received).toHaveLength(1);
  } finally {
    await sink.close();
  }
});

test('HARNESS HTTP sink records requests', async () => {
  const sink = new HttpSink(16691);
  await sink.listen();
  try {
    const res = await fetch('http://127.0.0.1:16691/x?y=1', { method: 'POST', body: 'hi' });
    expect(res.status).toBe(200);
    expect(sink.requests[0]).toMatchObject({ method: 'POST', url: '/x?y=1', body: 'hi' });
  } finally {
    await sink.close();
  }
});

test('HARNESS GreenMail inbox reader sees a mail sent over SMTP', async () => {
  const subject = `HARNESS mail ${String(Date.now())}`;
  await nodemailer.createTransport({ host: '127.0.0.1', port: MAIL.smtpPort, secure: false })
    .sendMail({ from: 'h@example.com', to: MAIL.address, subject, text: 'x' });
  await expect.poll(() => mailSubjects(subject), { timeout: 10_000 }).toEqual([subject]);
});

test('HARNESS SFTP, MySQL and partner Postgres are reachable', async () => {
  await withSftp(async (c) => { expect(await c.exists(SFTP.base)).toBeTruthy(); });
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: 'mirth', password: 'mirthpw', database: 'partner' });
  await conn.end();
  expect(await sql('SELECT 1 AS one')).toEqual([{ one: 1 }]);
});

test('HARNESS a natively built TCP channel delivers through the real server', async () => {
  const api = await Api.login();
  const sink = new MllpSink(16692);
  await sink.listen();
  try {
    const list = await api.get<{ data: Array<{ id: string; name: string }> }>('/channels?pageSize=100');
    let id = list.data.find((c) => c.name === 'HARNESS native TCP')?.id;
    if (!id) {
      const created = await api.post<{ id: string }>('/channels', {
        name: 'HARNESS native TCP',
        enabled: true,
        inboundDataType: 'HL7V2',
        outboundDataType: 'HL7V2',
        sourceConnectorType: 'TCP_MLLP',
        sourceConnectorProperties: { host: '127.0.0.1', port: 16693, maxConnections: 10, responseMode: 'AUTO_ACK', charset: 'utf-8', maxFrameBytes: 52428800 },
        responseMode: 'AUTO_AFTER_DESTINATIONS',
        destinations: [{ name: 'Out', connectorType: 'TCP_MLLP', properties: { host: '127.0.0.1', port: 16692, responseTimeout: 5000 } }],
      });
      id = created.id;
    }
    await api.undeploy(id);
    await api.deployAndStart(id);
    expect(await sendMllp(16693, 'MSH|^~\\&|A|B|C|D|20261110||ADT^A01|H2|P|2.5')).toContain('MSA|AA|H2');
    await expect.poll(() => sink.received.length, { timeout: 10_000 }).toBe(1);
  } finally {
    await sink.close();
    await api.dispose();
  }
});
