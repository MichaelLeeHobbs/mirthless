import { describe, it, expect } from 'vitest';
import { fhirDestinationPropertiesSchema } from '../fhir-connector.schema.js';

const DEFAULTS = { resourceType: 'Patient', method: 'POST', authType: 'NONE', format: 'json', timeout: 30_000, headers: {} };

describe('fhirDestinationPropertiesSchema', () => {
  it('needs a base URL and fills the defaults', () => {
    expect(fhirDestinationPropertiesSchema.parse({ baseUrl: 'https://fhir.example/r4' })).toEqual({ baseUrl: 'https://fhir.example/r4', ...DEFAULTS });
  });

  // Filled per message, as the HTTP destination's URL is (#414).
  it('takes a base URL that names a variable, which is no URL until it is filled', () => {
    expect(fhirDestinationPropertiesSchema.safeParse({ baseUrl: 'https://${host}:${port}/r4' }).success).toBe(true);
  });

  // FHIR_DEST_DEFAULTS since 349a666 (2026-07-12), a base URL filled.
  it('accepts what the editor saves', () => {
    const saved = {
      baseUrl: 'https://fhir.example/r4', resourceType: 'Patient', method: 'POST', authType: 'NONE', authUsername: '', authPassword: '',
      authToken: '', authHeaderName: '', authApiKey: '', format: 'json', timeout: 30000, headers: {},
    };
    expect(fhirDestinationPropertiesSchema.parse(saved)).toEqual(saved);
  });

  // From 45fad27 (2026-03-01) to 349a666 (2026-07-12) the form saved headers as `Name: value` lines.
  it('reads headers saved as text the way the editor shows them', () => {
    const parsed = fhirDestinationPropertiesSchema.parse({ baseUrl: 'https://f/r4', headers: 'X-Site: LAB\nX-Env: test' });
    expect(parsed.headers).toEqual({ 'X-Site': 'LAB', 'X-Env': 'test' });
    expect(fhirDestinationPropertiesSchema.parse({ baseUrl: 'https://f/r4', headers: '' }).headers).toEqual({});
  });

  it.each([
    [{ authType: 'BASIC', authUsername: 'u', authPassword: 'p' }],
    [{ authType: 'BEARER', authToken: 't' }],
    [{ authType: 'API_KEY', authHeaderName: 'X-Key', authApiKey: 'k' }],
  ])('accepts %j with its credentials', (auth) => {
    expect(fhirDestinationPropertiesSchema.safeParse({ baseUrl: 'https://f/r4', ...auth }).success).toBe(true);
  });

  it.each([
    [{ authType: 'BASIC', authUsername: 'u' }, 'authPassword'],
    [{ authType: 'BASIC', authPassword: 'p', authUsername: '' }, 'authUsername'],
    [{ authType: 'BEARER' }, 'authToken'],
    [{ authType: 'API_KEY', authApiKey: 'k' }, 'authHeaderName'],
    [{ authType: 'API_KEY', authHeaderName: 'X-Key' }, 'authApiKey'],
  ])('refuses %j, naming the missing credential %s', (auth, key) => {
    const result = fhirDestinationPropertiesSchema.safeParse({ baseUrl: 'https://f/r4', ...auth });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([key]);
  });

  it.each([
    ['baseUrl', ''],
    ['baseUrl', 'not a url'],
    ['resourceType', ''],
    ['method', 'PATCH'],
    ['authType', 'OAUTH'],
    ['format', 'turtle'],
    ['timeout', 0],
    ['timeout', 2_147_483_648],
    ['headers', { 'X-A': 1 }],
    ['authToken', 7],
  ])('rejects %s = %j, naming the key', (key, value) => {
    const result = fhirDestinationPropertiesSchema.safeParse({ baseUrl: 'https://f/r4', [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe(key);
  });

  it('refuses a key it does not list', () => {
    expect(fhirDestinationPropertiesSchema.safeParse({ baseUrl: 'https://f/r4', url: 'https://f' }).success).toBe(false);
  });
});
