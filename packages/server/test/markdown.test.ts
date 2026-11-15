// ===========================================
// Markdown helper tests
// ===========================================
// The docs guards trust this parser, so a parser that reads a broken table as
// fine would make every guard pass. These cases pin the edges.

import { describe, it, expect } from 'vitest';
import { headings, tables } from './markdown.js';

describe('docs markdown helper', () => {
  it('reads headings and skips ones inside code fences', () => {
    const md = ['# Title', '## A', '```', '## not a heading', '```', '### A: detail'].join('\n');
    expect(headings(md).map((h) => `${String(h.level)} ${h.text}`)).toEqual(['1 Title', '2 A', '3 A: detail']);
  });

  it('reads a table with the heading it sits under', () => {
    const md = ['## Things', '', '| Name | Value |', '|---|---|', '| a | 1 |', '| b | 2 |', '', 'after'].join('\n');
    const [t] = tables(md);
    expect(t?.header).toEqual(['Name', 'Value']);
    expect(t?.rows).toEqual([['a', '1'], ['b', '2']]);
    expect(t?.under?.text).toBe('Things');
  });

  it('keeps an escaped pipe inside a cell', () => {
    const md = ['| Field | Separator |', '|---|---|', '| MSH | `\\|` |'].join('\n');
    expect(tables(md)[0]?.rows[0]).toEqual(['MSH', '`|`']);
  });

  it('throws when a row has a different number of cells from its header', () => {
    const md = ['| A | B |', '|---|---|', '| 1 | 2 | 3 |'].join('\n');
    expect(() => tables(md)).toThrow(/has 3 cells; its header has 2/);
  });

  it('ignores a table inside a code fence', () => {
    const md = ['```', '| A | B |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
    expect(tables(md)).toEqual([]);
  });
});
