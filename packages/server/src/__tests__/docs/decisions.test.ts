// ===========================================
// Docs guard: docs/progress/DECISIONS.md
// ===========================================
// Code, docs and other guards cite decisions by number, so a number must name
// one decision. Git merges the file with merge=union (.gitattributes), which
// keeps both sides when two branches each add a decision. If both picked the
// same next number, the union keeps both copies without a conflict, and this
// test is what catches it. The branch that merges second renumbers (D-290).

import { describe, it, expect } from 'vitest';
import { readRepoFile } from '../../../test/markdown.js';

const DOC = 'docs/progress/DECISIONS.md';

/** Numbers that start more than one `D-NNN:` line, in file order. */
function duplicateNumbers(text: string): readonly string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const match of text.matchAll(/^(D-\d+):/gm)) {
    const id = match[1] ?? '';
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  return duplicates;
}

describe('decisions: numbering', () => {
  it('gives every decision its own number', () => {
    expect(duplicateNumbers(readRepoFile(DOC)), 'renumber the decision that merged second').toEqual([]);
  });

  it('finds a number used twice, as a union merge of two branches leaves it', () => {
    const merged = 'D-001: a — 2026-01-01\n\nD-002: ours — 2026-01-02\n\nD-002: theirs — 2026-01-02\n';
    expect(duplicateNumbers(merged)).toEqual(['D-002']);
  });

  it('ignores a decision cited inside another one', () => {
    expect(duplicateNumbers('D-001: a\n\nD-002: supersedes D-001\n')).toEqual([]);
  });

  it('is merged with merge=union, so parallel branches do not conflict on it', () => {
    expect(readRepoFile('.gitattributes')).toMatch(/^docs\/progress\/DECISIONS\.md\s+merge=union$/m);
  });
});
