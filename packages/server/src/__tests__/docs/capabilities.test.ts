// ===========================================
// Docs guard: docs/user/capabilities.md
// ===========================================
// The capabilities page is where users see what GalvaniFlow does and
// maintainers see the gaps. It is only useful if its statuses mean what the page
// says they mean, so this guard enforces the rules stated at its top:
// - Yes is proved by a test that runs in the gate or in CI, and the file exists;
// - No names its plan (an issue, or a ROADMAP ID that is open);
// - Won't names a decision that exists and quotes it;
// - every open ROADMAP item is the plan of some row, so the page is the gap list.
// Whether a Yes is still true beyond its proof test is not checked.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, readRepoFile, tables, brokenRelativeLinks, type Table } from '../../../test/markdown.js';

const DOC = 'docs/user/capabilities.md';
const markdown = readRepoFile(DOC);
const STATUS_HEADER = ['Capability', 'Status', 'Limits', 'Plan', 'Docs', 'Mirth', 'Proof'];
const MIGRATION_HEADER = ['Mirth feature', 'Imports as', 'Deploys', 'Warning at preview', 'Proof'];
const STATUSES = new Set(['Yes', 'Partial', 'No', "Won't"]);

type Lane = 'gate' | 'ci' | 'local' | 'manual' | 'unknown';

/** Where a proof file runs, from its path alone. */
function lane(path: string): Lane {
  if (/^packages\/[^/]+\/src\/.+\.test\.tsx?$/.test(path)) return 'gate';
  if (/^packages\/server\/test\/integration\/.+\.itest\.ts$/.test(path)) return 'ci';
  if (/^packages\/connectors\/src\/__tests__\/e2e\/integration\/.+\.itest\.ts$/.test(path)) return 'ci';
  if (/^e2e\/[^/]+\.spec\.ts$/.test(path)) return 'ci';
  if (/^e2e\/scenarios\/.+\.scenario\.ts$/.test(path)) return 'local';
  if (/^docs\/testing\/.+\.md$/.test(path)) return 'manual';
  return 'unknown';
}

/** Backticked paths in a Proof cell. */
function proofPaths(cell: string): readonly string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

/** Open ROADMAP items' IDs: unticked lines tagged like [V12], [N7], [B2] or a rank [3]. */
function openRoadmapIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of readRepoFile('docs/progress/ROADMAP.md').split(/\r?\n/)) {
    if (!/^\s*- \[ \]/.test(line)) continue;
    for (const m of line.matchAll(/\[([A-Z]{1,2}\d{1,3}|\d{1,3})\]/g)) ids.add(m[1] ?? '');
  }
  return ids;
}

/** ROADMAP IDs a Plan cell names, written "ROADMAP V12" or "ROADMAP 3". */
function roadmapIdsIn(cell: string): readonly string[] {
  return [...cell.matchAll(/ROADMAP ([A-Z]{1,2}\d{1,3}|\d{1,3})\b/g)].map((m) => m[1] ?? '');
}

function statusTables(): readonly Table[] {
  return tables(markdown).filter((t) => t.header[0] === 'Capability');
}

function rows(): ReadonlyArray<{ readonly section: string; readonly cells: readonly string[] }> {
  return statusTables().flatMap((t) => t.rows.map((cells) => ({ section: t.under?.text ?? '', cells })));
}

const decisions = readRepoFile('docs/progress/DECISIONS.md');

/** The text of decision D-NNN, up to the next decision. */
function decisionText(id: string): string | null {
  const start = decisions.search(new RegExp(`^${id}:`, 'm'));
  if (start < 0) return null;
  const next = decisions.slice(start + 1).search(/^D-\d+:/m);
  return next < 0 ? decisions.slice(start) : decisions.slice(start, start + 1 + next);
}

describe('capabilities page: tables', () => {
  it('uses the status columns in every capability table', () => {
    expect(statusTables().length).toBeGreaterThanOrEqual(8);
    for (const t of statusTables()) expect(t.header, `table under "${t.under?.text ?? ''}"`).toEqual(STATUS_HEADER);
  });

  it('has a Mirth migration table with its own columns', () => {
    const migration = tables(markdown).find((t) => t.under?.text === 'Mirth migration');
    expect(migration?.header).toEqual(MIGRATION_HEADER);
    expect(migration?.rows.length ?? 0).toBeGreaterThan(0);
  });

  it('names each capability once', () => {
    const names = rows().map((r) => r.cells[0] ?? '');
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe('capabilities page: statuses mean what the page says', () => {
  it('uses only Yes, Partial, No and Won\'t', () => {
    for (const r of rows()) expect(STATUSES.has(r.cells[1] ?? ''), `"${r.cells[0] ?? ''}" status "${r.cells[1] ?? ''}"`).toBe(true);
  });

  it('proves every Yes with a test that runs in the gate or CI', () => {
    for (const r of rows().filter((x) => x.cells[1] === 'Yes')) {
      const lanes = proofPaths(r.cells[6] ?? '').map(lane);
      expect(lanes.some((l) => l === 'gate' || l === 'ci'), `"${r.cells[0] ?? ''}" is Yes without gate or CI proof`).toBe(true);
    }
  });

  it('gives every No a plan', () => {
    const open = openRoadmapIds();
    for (const r of rows().filter((x) => x.cells[1] === 'No')) {
      const plan = r.cells[3] ?? '';
      const issue = /issues\/\d+/.test(plan);
      const roadmap = roadmapIdsIn(plan);
      expect(issue || roadmap.length > 0, `"${r.cells[0] ?? ''}" is No without a plan`).toBe(true);
      for (const id of roadmap) expect(open.has(id), `"${r.cells[0] ?? ''}" cites ROADMAP ${id}, which is not an open item`).toBe(true);
    }
  });

  it('backs every Won\'t with a decision it quotes', () => {
    for (const r of rows().filter((x) => x.cells[1] === "Won't")) {
      const m = /(D-\d+)\s*"([^"]+)"/.exec(r.cells[3] ?? '');
      expect(m, `"${r.cells[0] ?? ''}" is Won't without D-NNN "quote"`).not.toBeNull();
      const text = decisionText(m?.[1] ?? '');
      expect(text, `${m?.[1] ?? ''} does not exist`).not.toBeNull();
      expect(text?.toLowerCase(), `${m?.[1] ?? ''} does not say "${m?.[2] ?? ''}"`).toContain((m?.[2] ?? '').toLowerCase());
    }
  });
});

describe('capabilities page: it is the gap list', () => {
  it('cites every open ROADMAP item in some row\'s plan', () => {
    const cited = new Set(rows().flatMap((r) => roadmapIdsIn(r.cells[3] ?? '')));
    const missing = [...openRoadmapIds()].filter((id) => !cited.has(id));
    expect(missing, 'open ROADMAP items with no capability row').toEqual([]);
  });
});

describe('capabilities page: proof and links', () => {
  it('cites only proof files that exist, by a path whose lane is known', () => {
    const allRows = [...rows().map((r) => r.cells[6] ?? ''), ...(tables(markdown).find((t) => t.under?.text === 'Mirth migration')?.rows ?? []).map((c) => c[4] ?? '')];
    for (const path of allRows.flatMap(proofPaths)) {
      expect(existsSync(resolve(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
      expect(lane(path), `${path} is not a test file the page's lanes cover`).not.toBe('unknown');
    }
  });

  it('links only to files and headings that exist', () => {
    expect(brokenRelativeLinks(DOC)).toEqual([]);
  });
});
