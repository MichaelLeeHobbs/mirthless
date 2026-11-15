import { describe, it, expect } from 'vitest';
import { isSecretSetting } from '../secret-setting.js';

describe('isSecretSetting', () => {
  it('treats a setting typed password or secret, in any letter case, as a secret', () => {
    expect(isSecretSetting('custom.value', 'password')).toBe(true);
    expect(isSecretSetting('custom.value', 'secret')).toBe(true);
    expect(isSecretSetting('custom.value', 'Password')).toBe(true);
    expect(isSecretSetting('custom.value', 'SECRET')).toBe(true);
  });

  it('treats a setting with a secret-looking key as a secret even when typed string', () => {
    expect(isSecretSetting('smtp.auth_pass', 'string')).toBe(true);
    expect(isSecretSetting('some.api_token', 'string')).toBe(true);
    expect(isSecretSetting('x.API_KEY', 'string')).toBe(true);
    expect(isSecretSetting('tls.privatekey', 'string')).toBe(true);
    expect(isSecretSetting('tls.private_key', 'string')).toBe(true);
    expect(isSecretSetting('sftp.passphrase', 'string')).toBe(true);
    expect(isSecretSetting('db.credential', 'string')).toBe(true);
  });

  it('does not treat other settings as secrets', () => {
    expect(isSecretSetting('smtp.host', 'string')).toBe(false);
    expect(isSecretSetting('smtp.port', 'number')).toBe(false);
    expect(isSecretSetting('smtp.passive_mode', 'boolean')).toBe(false);
  });

  it('decides by key alone when the type is missing', () => {
    expect(isSecretSetting('smtp.host', null)).toBe(false);
    expect(isSecretSetting('smtp.host', undefined)).toBe(false);
    expect(isSecretSetting('smtp.password', null)).toBe(true);
  });
});
