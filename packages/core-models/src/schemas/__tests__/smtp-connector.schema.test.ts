import { describe, it, expect } from 'vitest';
import { smtpDestinationPropertiesSchema } from '../smtp-connector.schema.js';

const REQUIRED = { host: 'mail.example', from: 'lab@example', to: 'ward@example' };

describe('smtpDestinationPropertiesSchema', () => {
  it('needs host, from and to, and fills the defaults', () => {
    expect(smtpDestinationPropertiesSchema.parse(REQUIRED)).toEqual({
      ...REQUIRED, port: 587, secure: false, requireTLS: false, cc: '', bcc: '', subject: '',
      bodyTemplate: '${msg}', contentType: 'text/plain', attachContent: false, attachments: [],
    });
  });

  // SMTP_DEST_DEFAULTS since db4e6fd (2026-07-15), with the required fields filled and a blank attachment row.
  it('accepts what the editor saves', () => {
    const saved = {
      ...REQUIRED, port: 587, secure: false, requireTLS: false, authUser: '', authPass: '', cc: '', bcc: '', subject: '',
      bodyTemplate: '${msg}', contentType: 'text/plain', attachContent: false, attachments: [{ filename: '', mimeType: '', content: '' }],
    };
    expect(smtpDestinationPropertiesSchema.parse(saved)).toEqual(saved);
  });

  // The 2026-03 to 2026-07 form had no requireTLS or attachments; the importer writes these keys since c2beb12.
  it('accepts an older or imported destination', () => {
    expect(smtpDestinationPropertiesSchema.safeParse({ ...REQUIRED, port: 25, secure: false, authUser: 'u', authPass: 'p', bodyTemplate: 'x', contentType: 'text/html' }).success).toBe(true);
    expect(smtpDestinationPropertiesSchema.safeParse({ ...REQUIRED, port: '2525', template: '${message.encodedData}' }).success).toBe(true);
  });

  it.each([
    ['host', ''],
    ['from', ' '],
    ['to', ''],
    ['port', 0],
    ['port', 'smtp'],
    ['secure', 'true'],
    ['contentType', 'text/markdown'],
    ['attachments', 'a.txt'],
    ['attachments', [{ filename: 'a.txt' }]],
    ['attachments', [{ filename: 'a.txt', content: 'x', mimeType: 7 }]],
    ['attachments', [{ filename: 'a.txt', content: 'x', type: 'text/plain' }]],
    ['authUser', 5],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = smtpDestinationPropertiesSchema.safeParse({ ...REQUIRED, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe(key);
  });

  it('refuses a key it does not list', () => {
    expect(smtpDestinationPropertiesSchema.safeParse({ ...REQUIRED, user: 'u' }).success).toBe(false);
  });
});
