// ===========================================
// Scenario suite: test wrapper and partner helpers
// ===========================================

import { test } from '@playwright/test';
import { ImapFlow } from 'imapflow';
import SftpClient from 'ssh2-sftp-client';
import { Api } from './api.js';

/**
 * Declare one scenario. The title must start with its id ("S07 ..."): the
 * scorer matches results to weights in manifest.ts by that id.
 */
export function scenario(title: string, body: (api: Api) => Promise<void>): void {
  test(title, async () => {
    const api = await Api.login();
    try {
      await body(api);
    } finally {
      await api.dispose();
    }
  });
}

/** A UUID-shaped Mirth channel id that is stable per scenario and slot. */
export function mirthId(scenarioNo: number, slot = 1): string {
  const s = String(scenarioNo).padStart(4, '0');
  return `5c${s.slice(0, 2)}${s.slice(2)}00-0000-4000-8000-${String(slot).padStart(12, '0')}`;
}

// ----- GreenMail (docker compose --profile test) -----

export const MAIL = { smtpPort: 3025, imapPort: 3143, user: 'mirth', password: 'mirthpw', address: 'mirth@example.com' } as const;

/** Subjects of messages in the GreenMail inbox whose subject contains `needle`. */
export async function mailSubjects(needle: string): Promise<string[]> {
  const client = new ImapFlow({ host: '127.0.0.1', port: MAIL.imapPort, secure: false, auth: { user: MAIL.user, pass: MAIL.password }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const found: string[] = [];
      for await (const m of client.fetch('1:*', { envelope: true })) {
        const subject = m.envelope?.subject ?? '';
        if (subject.includes(needle)) found.push(subject);
      }
      return found;
    } finally {
      lock.release();
    }
  } catch {
    return [];
  } finally {
    await client.logout().catch(() => undefined);
  }
}

// ----- SFTP (docker compose --profile test) -----

export const SFTP = { host: '127.0.0.1', port: 2222, username: 'mirth', password: 'mirthpw', base: '/upload' } as const;

export async function withSftp<T>(fn: (c: SftpClient) => Promise<T>): Promise<T> {
  const c = new SftpClient();
  await c.connect({ host: SFTP.host, port: SFTP.port, username: SFTP.username, password: SFTP.password });
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
