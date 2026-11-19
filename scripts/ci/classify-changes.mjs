#!/usr/bin/env node
// CI change classifier (#177, D-288); rules and reasons in docs/ops/ci.md. It
// fails toward running: anything it cannot classify, and any error, selects
// everything.
// Only *.test.ts(x) files are scanned for the paths they read: a helper that
// holds the path hides it.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CI_JOBS = ['changes', 'build-lint-test', 'connector-integration', 'e2e', 'docs', 'ci-ok'];

export const GATE_COMMAND = 'pnpm build && pnpm lint && pnpm test:coverage && pnpm test:ci';

const LANE_ROOTS = {
  connectorIntegration: ['@galvanigraph/connectors'],
  pgIntegration: ['@galvanigraph/server'],
  e2e: ['@galvanigraph/server', '@galvanigraph/web'],
};

const E2E_PATH = /^(e2e\/|playwright\.[^/]+$)/;
const READ_ONLY_PATH =
  /^(docs\/|\.claude\/|\.github\/ISSUE_TEMPLATE\/|\.github\/PULL_REQUEST_TEMPLATE\.md$|\.github\/dependabot\.yml$|LICENSE$|[^/]+\.md$)/;
const PACKAGE_PATH = /^packages\/([^/]+)\//;
const TEST_FILE = /^packages\/[^/]+\/.*\.test\.tsx?$/;
const REPO_READER = /\b(REPO_ROOT|readRepoFile)\b/;

export function readWorkspace(root) {
  const out = new Map();
  for (const dir of readdirSync(join(root, 'packages'))) {
    const file = join(root, 'packages', dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    out.set(dir, { name: pkg.name, deps: Object.keys(all) });
  }
  return out;
}

export function readWorkspaceTestSources(root) {
  const files = execFileSync('git', ['ls-files', 'packages'], { cwd: root, encoding: 'utf8' }).split('\n');
  return files.filter((f) => TEST_FILE.test(f)).map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
}

function pathsNamed(source) {
  const named = [...source.matchAll(/(?:docs|e2e|\.claude|\.github)\/[\w./-]*/g)].map((m) => m[0]);
  const topLevelMd = [...source.matchAll(/\b[A-Z][A-Za-z_-]*\.md\b/g)].map((m) => m[0]);
  const segments = [...source.matchAll(/['"`](docs|e2e|\.claude|\.github)['"`]/g)].map((m) => `${m[1]}/`);
  return [...named, ...topLevelMd, ...segments];
}

export function findReaders(changed, testSources) {
  return testSources.filter(({ source }) => {
    const named = pathsNamed(source);
    return changed.some((path) => named.some((n) => path === n || (n.endsWith('/') && path.startsWith(n))));
  });
}

function withDependencies(roots, byName) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name) || !byName.has(name)) continue;
    seen.add(name);
    stack.push(...byName.get(name).deps);
  }
  return seen;
}

function withDependents(changed, byName) {
  const out = new Set();
  for (const [name] of byName) {
    const deps = withDependencies([name], byName);
    if ([...changed].some((c) => deps.has(c))) out.add(name);
  }
  return out;
}

function everything(reason) {
  return {
    full: true,
    reason,
    gate: true,
    testPackages: [],
    testFilter: '-r',
    pgIntegration: true,
    connectorIntegration: true,
    e2e: true,
    docs: false,
    docTests: [],
  };
}

export function classify({ changed, packages, testSources }) {
  if (changed.length === 0) return everything('no changed files found');
  const byName = new Map([...packages.values()].map((p) => [p.name, p]));
  const changedPackages = new Set();
  const readOnly = [];
  let e2ePath = false;
  for (const path of changed) {
    const dir = PACKAGE_PATH.exec(path)?.[1];
    if (dir !== undefined) {
      const pkg = packages.get(dir);
      if (!pkg) return everything(`${path} is in no workspace package`);
      changedPackages.add(pkg.name);
    } else if (E2E_PATH.test(path)) {
      e2ePath = true;
    } else if (READ_ONLY_PATH.test(path)) {
      readOnly.push(path);
    } else {
      return everything(`${path} has no narrower rule`);
    }
  }

  const testPackages = [...withDependents(changedPackages, byName)].sort();
  const lane = (key) => [...withDependencies(LANE_ROOTS[key], byName)].some((n) => changedPackages.has(n));
  const readers = new Set([...findReaders(readOnly, testSources), ...testSources.filter((t) => REPO_READER.test(t.source))]);
  const docTests = groupByPackage([...readers], packages).filter((t) => !testPackages.includes(t.pkg));
  return {
    full: false,
    reason: 'classified',
    gate: testPackages.length > 0,
    testPackages,
    testFilter: testPackages.map((p) => `--filter ${p}`).join(' '),
    pgIntegration: lane('pgIntegration'),
    connectorIntegration: lane('connectorIntegration'),
    e2e: e2ePath || lane('e2e'),
    docs: docTests.length > 0,
    docTests,
  };
}

function groupByPackage(tests, packages) {
  const out = new Map();
  for (const { path } of tests) {
    const [, dir, rest] = /^packages\/([^/]+)\/(.*)$/.exec(path);
    const name = packages.get(dir)?.name;
    if (!name) continue;
    const entry = out.get(name) ?? { pkg: name, dir: `packages/${dir}`, files: [] };
    entry.files.push(rest);
    out.set(name, entry);
  }
  return [...out.values()].sort((a, b) => a.pkg.localeCompare(b.pkg)).map((e) => ({ ...e, files: e.files.sort() }));
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Only a pull request narrows; docs/ops/ci.md says why a push to main runs everything.
export function findBase(root, env, argv) {
  if (argv[0]) return argv[0];
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !env.GITHUB_EVENT_PATH) return null;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  return git(root, ['merge-base', event.pull_request.base.sha, 'HEAD']);
}

function decide(root, env, argv) {
  try {
    const base = findBase(root, env, argv);
    if (!base) return everything(`no base to compare (${env.GITHUB_EVENT_NAME ?? 'no event'} on ${env.GITHUB_REF ?? 'no ref'})`);
    const changed = git(root, ['diff', '--name-only', '--no-renames', base, 'HEAD']).split('\n').filter(Boolean);
    const result = classify({ changed, packages: readWorkspace(root), testSources: readWorkspaceTestSources(root) });
    return { ...result, base, changed };
  } catch (err) {
    return everything(`classifier error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeOutputs(result, file) {
  const lines = [
    `full=${result.full}`,
    `gate=${result.gate}`,
    `test_filter=${result.testFilter}`,
    `pg_integration=${result.pgIntegration}`,
    `connector_integration=${result.connectorIntegration}`,
    `e2e=${result.e2e}`,
    `docs=${result.docs}`,
    // One line per package: `<package dir> <file> <file>...`, read by the docs job.
    'doc_tests<<GALVANIGRAPH_EOF',
    ...result.docTests.map((t) => `${t.dir} ${t.files.join(' ')}`),
    'GALVANIGRAPH_EOF',
  ];
  appendFileSync(file, `${lines.join('\n')}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const result = decide(root, process.env, process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) writeOutputs(result, process.env.GITHUB_OUTPUT);
}
