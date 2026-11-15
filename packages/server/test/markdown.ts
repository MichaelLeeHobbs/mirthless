// ===========================================
// Markdown helpers for the docs guard tests
// ===========================================
// The docs guards in src/__tests__/docs/ read user docs and compare them with
// the code. This file parses just enough Markdown for that: headings and pipe
// tables, skipping fenced code blocks. It lives under test/ so it is neither
// built nor counted as source coverage.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (packages/server/test -> repo). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Read a file by its path from the repository root. */
export function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

export interface Heading {
  readonly level: number;
  readonly text: string;
  /** 1-based line number. */
  readonly line: number;
}

export interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** 1-based line number of the header row. */
  readonly line: number;
  /** The nearest heading above the table, or null. */
  readonly under: Heading | null;
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(markdown: string): ReadonlyArray<{ readonly text: string; readonly line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ text, line: i + 1 });
  });
  return out;
}

/** ATX headings (`#` to `######`) outside code fences. */
export function headings(markdown: string): readonly Heading[] {
  const out: Heading[] = [];
  for (const { text, line } of proseLines(markdown)) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (m?.[1] && m[2]) out.push({ level: m[1].length, text: m[2], line });
  }
  return out;
}

/** Split a table row into trimmed cells, honouring `\|` escapes. */
function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

const DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Pipe tables outside code fences, written with a leading `|` on every row (the
 * house style). Throws when a row has a different number of cells from its
 * header, so a shifted or missing column fails loudly instead of passing; GFM
 * would render a short row, but these docs never need one.
 */
export function tables(markdown: string): readonly Table[] {
  const lines = proseLines(markdown);
  const out: Table[] = [];
  let under: Heading | null = null;
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (!current) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(current.text);
    if (h?.[1] && h[2]) {
      under = { level: h[1].length, text: h[2], line: current.line };
      continue;
    }
    const next = lines[i + 1];
    if (!current.text.trim().startsWith('|') || !next || !DIVIDER.test(next.text)) continue;
    const header = cells(current.text);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = lines[j];
      if (!row || !row.text.trim().startsWith('|')) break;
      const rowCells = cells(row.text);
      if (rowCells.length !== header.length) {
        throw new Error(`Table row at line ${String(row.line)} has ${String(rowCells.length)} cells; its header has ${String(header.length)}`);
      }
      rows.push(rowCells);
    }
    out.push({ header, rows, line: current.line, under });
    i = j - 1;
  }
  return out;
}

/**
 * The anchors GitHub generates for a document's headings: lowercased, punctuation
 * other than `-` and `_` dropped, spaces as `-`, and `-1`, `-2` ... on repeats.
 */
export function headingAnchors(markdown: string): ReadonlySet<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const h of headings(markdown)) {
    const base = h.text
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${String(n)}`);
  }
  return anchors;
}

/**
 * Relative links that lead nowhere: a file that doesn't exist, or a `#fragment`
 * that matches no heading in the target (or in this doc, for `#fragment` alone).
 * Links with a scheme (https:, mailto:) are not checked.
 */
export function brokenRelativeLinks(relativeDocPath: string): readonly string[] {
  const markdown = readRepoFile(relativeDocPath);
  const docDir = dirname(resolve(REPO_ROOT, relativeDocPath));
  const broken: string[] = [];
  for (const { text } of proseLines(markdown)) {
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1] ?? '';
      if (/^[a-z]+:/i.test(target)) continue;
      const [file = '', fragment] = target.split('#');
      const path = file ? resolve(docDir, file) : resolve(REPO_ROOT, relativeDocPath);
      if (!existsSync(path)) {
        broken.push(target);
        continue;
      }
      if (fragment && path.endsWith('.md') && !headingAnchors(readFileSync(path, 'utf8')).has(fragment)) broken.push(target);
    }
  }
  return broken;
}
