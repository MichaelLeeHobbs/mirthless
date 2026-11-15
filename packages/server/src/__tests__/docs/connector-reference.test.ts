// ===========================================
// Docs guard: docs/user/connector-reference.md
// ===========================================
// The connector reference answers "can this connector be a source, a
// destination, or both?" These tests fail when the page and the core-models
// connector lists disagree, so adding a connector without documenting it
// fails pnpm gate. (The registry is checked against the same lists in
// packages/connectors/src/__tests__/registry-types.test.ts.)

import { describe, it, expect } from 'vitest';
import { CONNECTOR_TYPES, SOURCE_CONNECTOR_TYPES, DESTINATION_CONNECTOR_TYPES } from '@galvaniflow/core-models';
import { readRepoFile, headings, tables, brokenRelativeLinks } from '../../../test/markdown.js';

const DOC = 'docs/user/connector-reference.md';
const markdown = readRepoFile(DOC);
const isSource = (t: string): boolean => (SOURCE_CONNECTOR_TYPES as readonly string[]).includes(t);
const isDestination = (t: string): boolean => (DESTINATION_CONNECTOR_TYPES as readonly string[]).includes(t);

const GLANCE_HEADER = ['Connector', 'Source', 'Destination', 'Covers', 'Transport security', 'Auth', 'Mirth equivalent'];
const PROPERTY_HEADER = ['Property', 'Required', 'Notes'];

function glanceTable(): { readonly rows: readonly (readonly string[])[] } {
  const table = tables(markdown).find((t) => t.under?.text === 'Connectors at a glance');
  if (!table) throw new Error(`${DOC} has no table under "## Connectors at a glance"`);
  expect(table.header).toEqual(GLANCE_HEADER);
  return table;
}

/** The headings under `## TYPE`, up to the next level-2 heading. */
function subheadings(type: string): readonly string[] {
  const all = headings(markdown);
  const start = all.findIndex((h) => h.level === 2 && h.text === type);
  if (start < 0) return [];
  const out: string[] = [];
  for (const h of all.slice(start + 1)) {
    if (h.level <= 2) break;
    if (h.level === 3) out.push(h.text);
  }
  return out;
}

describe('connector reference: at-a-glance matrix', () => {
  it('has one row per connector type, linking that connector\'s section', () => {
    const linked = glanceTable().rows.map((row) => {
      const m = /^\[([A-Z_]+)\]\(#([a-z_]+)\)$/.exec(row[0] ?? '');
      expect(m, `Connector cell "${row[0] ?? ''}" must be [TYPE](#type)`).not.toBeNull();
      expect(m?.[2]).toBe(m?.[1]?.toLowerCase());
      return m?.[1] ?? '';
    });
    expect([...linked].sort()).toEqual([...CONNECTOR_TYPES].sort());
  });

  it('marks Source and Destination exactly as the connector lists do', () => {
    for (const row of glanceTable().rows) {
      const type = /\[([A-Z_]+)\]/.exec(row[0] ?? '')?.[1] ?? '';
      expect(row[1], `${type} Source`).toBe(isSource(type) ? 'Yes' : 'No');
      expect(row[2], `${type} Destination`).toBe(isDestination(type) ? 'Yes' : 'No');
    }
  });

  it('fills every cell', () => {
    for (const row of glanceTable().rows) {
      for (const [i, cell] of row.entries()) expect(cell, `${row[0] ?? ''} column ${GLANCE_HEADER[i] ?? ''}`).not.toBe('');
    }
  });
});

describe('connector reference: one section per connector', () => {
  it('has a level-2 section for every connector and no other level-2 sections', () => {
    const allowed = new Set<string>(['Connectors at a glance', 'Keys on every connector', 'Choosing a connector', ...CONNECTOR_TYPES]);
    const level2 = headings(markdown).filter((h) => h.level === 2).map((h) => h.text);
    for (const type of CONNECTOR_TYPES) expect(level2, `missing "## ${type}"`).toContain(type);
    for (const text of level2) expect(allowed.has(text), `unexpected "## ${text}"`).toBe(true);
  });

  it.each([...CONNECTOR_TYPES])('gives %s the headings that match its directions', (type) => {
    const expected = [
      `${type}: what it does`,
      `${type} security`,
      ...(isSource(type) ? [`${type} as a source`] : []),
      ...(isDestination(type) ? [`${type} as a destination`] : []),
      `${type} limits`,
    ];
    expect(subheadings(type)).toEqual(expected);
  });

  it.each([...CONNECTOR_TYPES])('gives %s a property table for each direction it supports', (type) => {
    const under = new Set(tables(markdown).map((t) => t.under?.text));
    if (isSource(type)) expect(under.has(`${type} as a source`), `${type} source table`).toBe(true);
    if (isDestination(type)) expect(under.has(`${type} as a destination`), `${type} destination table`).toBe(true);
  });

  it('uses the Property | Required | Notes header for every property table', () => {
    const propertyTables = tables(markdown).filter((t) => / as a (source|destination)$/.test(t.under?.text ?? ''));
    for (const t of propertyTables) {
      expect(t.header, `table under "${t.under?.text ?? ''}"`).toEqual(PROPERTY_HEADER);
      for (const row of t.rows) {
        expect(row[0], `property cell under "${t.under?.text ?? ''}"`).toMatch(/^`[A-Za-z0-9_.[\]]+`$/);
        expect(['Yes', 'No'], `Required for ${row[0] ?? ''}`).toContain(row[1]);
      }
    }
  });
});

describe('connector reference: links', () => {
  it('links only to files and headings that exist', () => {
    expect(brokenRelativeLinks(DOC)).toEqual([]);
  });
});
