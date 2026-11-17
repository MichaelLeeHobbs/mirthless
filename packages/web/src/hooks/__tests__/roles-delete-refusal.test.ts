import { describe, it, expect } from 'vitest';
import { deleteRefusal } from '../use-roles.js';

const MESSAGE = 'The role is assigned 3 time(s); remove those assignments first';

describe('deleteRefusal', () => {
  it('names each holder once when the server lists them', () => {
    const assignments = [{ username: 'alice' }, { username: 'alice' }, { username: 'bob' }];
    expect(deleteRefusal({ message: MESSAGE, details: { assignments } })).toBe(`${MESSAGE}. Held by: alice, bob.`);
  });

  it('keeps the server\'s message, with its count, when the caller may not read users', () => {
    expect(deleteRefusal({ message: MESSAGE, details: { assignments: 3 } })).toBe(MESSAGE);
  });

  it('keeps the message when there are no details', () => {
    expect(deleteRefusal({ message: MESSAGE, details: undefined })).toBe(MESSAGE);
  });
});
