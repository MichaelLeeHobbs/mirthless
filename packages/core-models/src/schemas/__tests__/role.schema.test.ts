import { describe, it, expect } from 'vitest';
import { createRoleSchema, updateRoleSchema, roleIdParamSchema } from '../role.schema.js';

describe('createRoleSchema', () => {
  it('accepts a role with known permissions, and defaults the description', () => {
    const parsed = createRoleSchema.parse({ name: ' Lab analyst ', permissions: ['messages:read', 'channels:read'] });
    expect(parsed).toEqual({ name: 'Lab analyst', description: '', permissions: ['messages:read', 'channels:read'] });
  });

  it('carries the role it was cloned from', () => {
    const id = '3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c';
    expect(createRoleSchema.parse({ name: 'Copy', permissions: [], clonedFrom: id }).clonedFrom).toBe(id);
  });

  it.each([
    ['an unknown permission', { name: 'x', permissions: ['tags:write'] }],
    ['a permission listed twice', { name: 'x', permissions: ['channels:read', 'channels:read'] }],
    ['a blank name', { name: '   ', permissions: [] }],
    ['a name with a line break', { name: 'a\nb', permissions: [] }],
    ['a name over 100 characters', { name: 'x'.repeat(101), permissions: [] }],
    ['an admin flag', { name: 'x', permissions: [], admin: true }],
    ['a clonedFrom that is not an id', { name: 'x', permissions: [], clonedFrom: 'admin' }],
  ])('refuses %s', (_label, input) => {
    expect(createRoleSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateRoleSchema', () => {
  it('accepts any subset of name, description and permissions', () => {
    expect(updateRoleSchema.parse({})).toEqual({});
    expect(updateRoleSchema.parse({ permissions: ['channels:read'] })).toEqual({ permissions: ['channels:read'] });
  });

  it('refuses a field it does not know', () => {
    expect(updateRoleSchema.safeParse({ builtIn: false }).success).toBe(false);
  });
});

describe('roleIdParamSchema', () => {
  it('needs a uuid', () => {
    expect(roleIdParamSchema.safeParse({ id: 'admin' }).success).toBe(false);
  });
});
