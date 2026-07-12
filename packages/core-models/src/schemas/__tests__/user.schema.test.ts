// ===========================================
// User Schema Tests
// ===========================================

import { describe, it, expect } from 'vitest';
import {
  passwordSchema,
  changeOwnPasswordSchema,
  createUserSchema,
} from '../user.schema.js';

describe('passwordSchema', () => {
  it('accepts a password with letters and numbers', () => {
    expect(passwordSchema.safeParse('Admin123!').success).toBe(true);
    expect(passwordSchema.safeParse('password123').success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(passwordSchema.safeParse('Ab1').success).toBe(false);
  });

  it('rejects a password with no digit', () => {
    const result = passwordSchema.safeParse('onlyletters');
    expect(result.success).toBe(false);
  });

  it('rejects a password with no letter', () => {
    const result = passwordSchema.safeParse('12345678');
    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(passwordSchema.safeParse('a1'.repeat(65)).success).toBe(false);
  });
});

describe('changeOwnPasswordSchema', () => {
  it('requires a non-empty current password and a complex new password', () => {
    const ok = changeOwnPasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'NewPass123' });
    expect(ok.success).toBe(true);
  });

  it('rejects an empty current password', () => {
    const result = changeOwnPasswordSchema.safeParse({ currentPassword: '', newPassword: 'NewPass123' });
    expect(result.success).toBe(false);
  });

  it('rejects a weak new password', () => {
    const result = changeOwnPasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'weak' });
    expect(result.success).toBe(false);
  });
});

describe('createUserSchema', () => {
  it('enforces the password policy on user creation', () => {
    const result = createUserSchema.safeParse({
      username: 'jdoe',
      email: 'jdoe@example.com',
      password: 'nodigits',
    });
    expect(result.success).toBe(false);
  });
});
