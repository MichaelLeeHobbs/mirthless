import { describe, it, expect } from 'vitest';
import { emailSourcePropertiesSchema } from '../email-connector.schema.js';

// EMAIL_SOURCE_DEFAULTS since dad3da5 (2026-03-03), with the login filled and without includeAttachments (#154).
const SAVED = {
  host: 'imap.example', port: 993, secure: true, username: 'lab', password: 'p', protocol: 'IMAP', folder: 'INBOX',
  pollingIntervalMs: 60000, postAction: 'MARK_READ', moveToFolder: '', subjectFilter: '',
};

describe('emailSourcePropertiesSchema', () => {
  it('accepts what the editor saves, as it is', () => {
    expect(emailSourcePropertiesSchema.parse(SAVED)).toEqual(SAVED);
  });

  it('needs host, username and password, and fills the rest', () => {
    expect(emailSourcePropertiesSchema.parse({ host: 'imap.example', username: 'lab', password: 'p', processBatch: true })).toEqual({ ...SAVED, processBatch: true });
  });

  it.each([
    ['host', ''],
    ['username', ' '],
    ['password', ''],
    ['port', 0],
    ['secure', 'true'],
    ['protocol', 'POP3'],
    ['protocol', 'SMTP'],
    ['folder', ''],
    ['pollingIntervalMs', 999],
    ['pollingIntervalMs', 2_147_483_648],
    ['postAction', 'ARCHIVE'],
    ['mailbox', 'INBOX'],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = emailSourcePropertiesSchema.safeParse({ ...SAVED, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });

  it.each([true, false, 'yes'])('drops includeAttachments = %j, which the editor saved and nothing read', (includeAttachments) => {
    expect(emailSourcePropertiesSchema.parse({ ...SAVED, includeAttachments })).toEqual(SAVED);
  });

  it('needs a move-to folder when the post action is MOVE', () => {
    const result = emailSourcePropertiesSchema.safeParse({ ...SAVED, postAction: 'MOVE' });
    expect(result.success ? [] : result.error.issues.map((i) => i.path)).toEqual([['moveToFolder']]);
  });
});
