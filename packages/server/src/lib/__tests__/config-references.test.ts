// ===========================================
// Configuration map references in connector settings
// ===========================================

import { describe, it, expect } from 'vitest';
import { configLookup, resolveConfigReferences } from '../config-references.js';

const entries = [
  { category: 'vns', name: 'SENDER_HOST', value: 'lis.example.org' },
  { category: 'vns', name: 'SENDER_PORT', value: '6661' },
  { category: 'east', name: 'SITE', value: 'E' },
  { category: 'west', name: 'SITE', value: 'W' },
  { category: 'vns', name: 'UNSET', value: null },
];

describe('configLookup', () => {
  it('finds a value by category.name, and by name when only one category has it', () => {
    const lookup = configLookup(entries);
    expect(lookup.get('vns.SENDER_HOST')).toBe('lis.example.org');
    expect(lookup.get('SENDER_HOST')).toBe('lis.example.org');
    expect(lookup.get('east.SITE')).toBe('E');
    expect(lookup.has('SITE')).toBe(false);
    expect(lookup.has('UNSET')).toBe(false);
  });
});

describe('resolveConfigReferences', () => {
  const lookup = configLookup(entries);

  it('replaces references in nested strings and leaves message variables for the message', () => {
    const resolved = resolveConfigReferences({
      host: '${SENDER_HOST}', port: '${vns.SENDER_PORT}',
      template: '${oru}', headers: { 'X-Site': 'site ${west.SITE}' }, retries: 3,
    }, lookup);
    expect(resolved).toEqual({
      host: 'lis.example.org', port: '6661',
      template: '${oru}', headers: { 'X-Site': 'site W' }, retries: 3,
    });
  });

  it.each(['script', 'query', 'selectQuery', 'updateQuery'])('leaves %s alone: it is code or SQL with its own ${...}', (key) => {
    const text = key === 'script' ? 'const url = `http://${SENDER_HOST}`;' : 'INSERT INTO t (h) VALUES (${SENDER_HOST})';
    expect(resolveConfigReferences({ [key]: text, host: '${SENDER_HOST}' }, lookup)).toEqual({ [key]: text, host: 'lis.example.org' });
  });

  it('does not resolve a name two categories share', () => {
    expect(resolveConfigReferences({ site: '${SITE}' }, lookup)).toEqual({ site: '${SITE}' });
  });

  it('does not change the properties it was given', () => {
    const props = { host: '${SENDER_HOST}' };
    resolveConfigReferences(props, lookup);
    expect(props.host).toBe('${SENDER_HOST}');
  });
});
