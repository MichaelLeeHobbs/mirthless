import { describe, expect, it } from 'vitest';
import { PG_ERROR, pgCode, uniqueConstraint } from '../pg-error.js';

const taken = Object.assign(new Error('duplicate key'), { code: PG_ERROR.UNIQUE_VIOLATION, constraint: 'users_email_unique' });

describe('pgCode', () => {
  it.each([
    ['the driver\'s own error', taken],
    ['one a failed statement wraps', new Error('Failed query', { cause: taken })],
  ])('reads %s', (_what, err) => {
    expect(pgCode(err)).toBe('23505');
  });

  it.each([null, undefined, 'text', new Error('no code'), new Error('wraps nothing', { cause: null })])('is undefined for %s', (err) => {
    expect(pgCode(err)).toBeUndefined();
  });
});

describe('uniqueConstraint', () => {
  it.each([
    ['the driver\'s own error', taken],
    ['one a failed statement wraps', new Error('Failed query', { cause: taken })],
  ])('names the constraint of %s', (_what, err) => {
    expect(uniqueConstraint(err)).toBe('users_email_unique');
  });

  it.each([
    ['another refusal that names a constraint', Object.assign(new Error('fk'), { code: PG_ERROR.FOREIGN_KEY_VIOLATION, constraint: 'sessions_user_id_fk' })],
    ['one that names no constraint', Object.assign(new Error('duplicate key'), { code: PG_ERROR.UNIQUE_VIOLATION })],
    ['an error that is not the database\'s', new Error('mine')],
    ['nothing', undefined],
  ])('is null for %s', (_what, err) => {
    expect(uniqueConstraint(err)).toBeNull();
  });
});
