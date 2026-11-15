// Table tests for the CI change classifier (#177). Run with `pnpm test:ci`,
// which `pnpm gate` runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify, findReaders, readWorkspace, readWorkspaceTestSources, CI_JOBS, GATE_COMMAND } from './classify-changes.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// The real workspace graph, so a new package dependency changes these tests'
// expectations the same way it changes CI.
const packages = readWorkspace(ROOT);

const SERVER_DOC_TEST = {
  path: 'packages/server/src/__tests__/docs/connector-reference.test.ts',
  source: "const DOC = 'docs/user/connector-reference.md';",
};
const MODELS_DOC_TEST = {
  path: 'packages/core-models/src/schemas/__tests__/connector-reference-docs.test.ts',
  source: "readFileSync(new URL('../../../../../docs/user/connector-reference.md', import.meta.url))",
};
const PLAIN_TEST = { path: 'packages/web/src/lib/format.test.ts', source: "import { formatTimestamp } from './format.js';" };
const testSources = [SERVER_DOC_TEST, MODELS_DOC_TEST, PLAIN_TEST];

const run = (changed) => classify({ changed, packages, testSources });

/** Which of the classifier's jobs run, as a sorted list. */
function jobs(result) {
  const out = [];
  if (result.gate) out.push('gate');
  if (result.pgIntegration) out.push('pg');
  if (result.connectorIntegration) out.push('connectors');
  if (result.e2e) out.push('e2e');
  if (result.docs) out.push('docs');
  return out.sort();
}

const EVERYTHING = ['connectors', 'e2e', 'gate', 'pg'];

const TABLE = [
  // Root config and CI itself run everything.
  { changed: ['package.json'], jobs: EVERYTHING, full: true },
  { changed: ['pnpm-lock.yaml'], jobs: EVERYTHING, full: true },
  { changed: ['pnpm-workspace.yaml'], jobs: EVERYTHING, full: true },
  { changed: ['tsconfig.json'], jobs: EVERYTHING, full: true },
  { changed: ['tsconfig.build.json'], jobs: EVERYTHING, full: true },
  { changed: ['eslint.config.js'], jobs: EVERYTHING, full: true },
  { changed: ['.github/workflows/ci.yml'], jobs: EVERYTHING, full: true },
  { changed: ['.github/workflows/docker-build.yml'], jobs: EVERYTHING, full: true },
  { changed: ['docker/docker-compose.yml'], jobs: EVERYTHING, full: true },
  { changed: ['scripts/ci/classify-changes.mjs'], jobs: EVERYTHING, full: true },
  { changed: ['.npmrc'], jobs: EVERYTHING, full: true },
  // A path the classifier has no rule for runs everything.
  { changed: ['some-new-top-level-file.json'], jobs: EVERYTHING, full: true },
  { changed: ['packages/brand-new/src/index.ts'], jobs: EVERYTHING, full: true },
  // Packages: a job runs when a package it exercises, or one of their dependencies, changed.
  { changed: ['packages/web/src/App.tsx'], jobs: ['e2e', 'gate'], test: ['@galvaniflow/web'] },
  { changed: ['packages/server/src/app.ts'], jobs: ['e2e', 'gate', 'pg'], test: ['@galvaniflow/server'] },
  { changed: ['packages/connectors/src/registry.ts'], jobs: EVERYTHING, test: ['@galvaniflow/connectors', '@galvaniflow/server'] },
  { changed: ['packages/engine/src/index.ts'], jobs: EVERYTHING, test: ['@galvaniflow/connectors', '@galvaniflow/engine', '@galvaniflow/server'] },
  { changed: ['packages/cli/src/index.ts'], jobs: ['gate'], test: ['@galvaniflow/cli'] },
  {
    changed: ['packages/core-util/src/index.ts'],
    jobs: EVERYTHING,
    test: ['@galvaniflow/connectors', '@galvaniflow/core-util', '@galvaniflow/engine', '@galvaniflow/server', '@galvaniflow/web'],
  },
  {
    changed: ['packages/core-models/src/index.ts'],
    jobs: EVERYTHING,
    test: ['@galvaniflow/cli', '@galvaniflow/connectors', '@galvaniflow/core-models', '@galvaniflow/core-util', '@galvaniflow/engine', '@galvaniflow/server', '@galvaniflow/web'],
  },
  // E2E specs alone run only the e2e job.
  { changed: ['e2e/auth.spec.ts'], jobs: ['e2e'] },
  { changed: ['playwright.config.ts'], jobs: ['e2e'] },
  // Docs: only the tests that read the changed file.
  { changed: ['docs/user/connector-reference.md'], jobs: ['docs'] },
  { changed: ['docs/progress/CHANGELOG.md'], jobs: [] },
  { changed: ['AGENTS.md', 'README.md'], jobs: [] },
  { changed: ['.claude/skills/create-ui/SKILL.md'], jobs: [] },
  { changed: ['.github/ISSUE_TEMPLATE/bug_report.md', '.github/PULL_REQUEST_TEMPLATE.md'], jobs: [] },
  // The gate already runs the doc test's package, so the docs job is not needed.
  { changed: ['docs/user/connector-reference.md', 'packages/server/src/app.ts'], jobs: ['docs', 'e2e', 'gate', 'pg'], test: ['@galvaniflow/server'] },
  { changed: ['docs/user/connector-reference.md', 'packages/web/src/App.tsx'], jobs: ['docs', 'e2e', 'gate'], test: ['@galvaniflow/web'] },
  // One root file among many still runs everything.
  { changed: ['docs/README.md', 'packages/web/src/App.tsx', 'pnpm-lock.yaml'], jobs: EVERYTHING, full: true },
];

for (const row of TABLE) {
  test(`${row.changed.join(' + ')} runs ${row.jobs.join(', ') || 'nothing'}`, () => {
    const result = run(row.changed);
    assert.deepEqual(jobs(result), row.jobs);
    assert.equal(result.full, row.full === true);
    if (row.full) assert.equal(result.testFilter, '-r');
    if (row.test) assert.deepEqual(result.testPackages, row.test);
  });
}

test('an empty diff runs everything, since the classifier cannot tell what changed', () => {
  const result = run([]);
  assert.equal(result.full, true);
  assert.deepEqual(jobs(result), EVERYTHING);
});

test('the test filter names each package to test', () => {
  assert.equal(run(['packages/server/src/app.ts']).testFilter, '--filter @galvaniflow/server');
});

test('docs job runs only the doc tests outside the packages the gate tests', () => {
  const docsOnly = run(['docs/user/connector-reference.md']);
  assert.deepEqual(docsOnly.docTests, [
    { pkg: '@galvaniflow/core-models', files: ['src/schemas/__tests__/connector-reference-docs.test.ts'] },
    { pkg: '@galvaniflow/server', files: ['src/__tests__/docs/connector-reference.test.ts'] },
  ]);
  const withServer = run(['docs/user/connector-reference.md', 'packages/server/src/app.ts']);
  assert.deepEqual(withServer.docTests, [
    { pkg: '@galvaniflow/core-models', files: ['src/schemas/__tests__/connector-reference-docs.test.ts'] },
  ]);
});

test('a full run leaves doc tests to the gate', () => {
  const result = run(['docs/user/connector-reference.md', 'package.json']);
  assert.equal(result.docs, false);
  assert.deepEqual(result.docTests, []);
});

test('findReaders matches a test by the path it names, a directory it names, or a quoted docs segment', () => {
  const sources = [
    { path: 'packages/a/src/exact.test.ts', source: "read('docs/user/x.md')" },
    { path: 'packages/a/src/dir.test.ts', source: "readdirSync('docs/user/')" },
    { path: 'packages/a/src/joined.test.ts', source: "join(ROOT, 'docs', name)" },
    { path: 'packages/a/src/agents.test.ts', source: "read('AGENTS.md')" },
    { path: 'packages/a/src/other.test.ts', source: "read('docs/ops/y.md')" },
  ];
  const readers = (path) => findReaders([path], sources).map((s) => s.path.split('/').pop()).sort();
  assert.deepEqual(readers('docs/user/x.md'), ['dir.test.ts', 'exact.test.ts', 'joined.test.ts']);
  assert.deepEqual(readers('docs/ops/y.md'), ['joined.test.ts', 'other.test.ts']);
  assert.deepEqual(readers('AGENTS.md'), ['agents.test.ts']);
  assert.deepEqual(readers('README.md'), []);
});

test('the real doc guards are found by what they read', () => {
  // Guards against a refactor that moves the path literal out of the test files.
  const result = classify({
    changed: ['docs/user/connector-reference.md'],
    packages,
    testSources: readWorkspaceTestSources(ROOT),
  });
  const found = result.docTests.flatMap((t) => t.files.map((f) => `${t.pkg} ${f}`));
  assert.ok(found.includes('@galvaniflow/server src/__tests__/docs/connector-reference.test.ts'), found.join('\n'));
  assert.ok(found.includes('@galvaniflow/core-models src/schemas/__tests__/connector-reference-docs.test.ts'), found.join('\n'));
});

// ci.yml must match what the classifier knows, or a new job runs unguarded
// (or never runs) and ci-ok stops meaning "everything passed".
const ciYml = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** Top-level job ids and each job's body text, from ci.yml's two-space indentation. */
function ciJobs() {
  const lines = ciYml.split(/\r?\n/);
  const start = lines.indexOf('jobs:');
  const out = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      out.set(current, '');
    } else if (current) {
      out.set(current, `${out.get(current)}${line}\n`);
    }
  }
  return out;
}

test('ci.yml has exactly the jobs the classifier knows', () => {
  assert.deepEqual([...ciJobs().keys()].sort(), [...CI_JOBS].sort());
});

test('ci-ok needs every other job and runs even when they fail', () => {
  const body = ciJobs().get('ci-ok') ?? '';
  const needs = /needs:\s*\[([^\]]*)\]/.exec(body)?.[1]?.split(',').map((s) => s.trim()) ?? [];
  assert.deepEqual(needs.sort(), CI_JOBS.filter((j) => j !== 'ci-ok').sort());
  assert.match(body, /if: always\(\)/);
});

test('every job but changes and ci-ok is gated on a changes output', () => {
  for (const [id, body] of ciJobs()) {
    if (id === 'changes' || id === 'ci-ok') continue;
    assert.match(body, /if: needs\.changes\.outputs\.[a-z0-9_]+ == 'true'/, `${id} has no if: on needs.changes.outputs`);
  }
});

test('the CI gate step runs what pnpm gate runs', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.gate, GATE_COMMAND);
});
