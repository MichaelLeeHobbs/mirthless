import { describe, it, expect } from 'vitest';
import { certificateListQuerySchema } from '../certificate.schema.js';

describe('certificateListQuerySchema', () => {
  it.each([
    ['true', true], ['1', true], ['false', false], ['0', false],
  ])('reads expiringSoon=%s from the query string as %s (#419)', (text, expected) => {
    expect(certificateListQuerySchema.parse({ expiringSoon: text })).toEqual({ expiringSoon: expected });
  });

  it('leaves expiringSoon unset when the query string does not carry it', () => {
    expect(certificateListQuerySchema.parse({})).toEqual({});
  });

  it('refuses text that is neither yes nor no', () => {
    expect(certificateListQuerySchema.safeParse({ expiringSoon: 'soon' }).success).toBe(false);
  });
});
