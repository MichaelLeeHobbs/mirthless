#!/usr/bin/env node
// CI change classifier (#177). The `changes` job in .github/workflows/ci.yml
// runs this to decide which jobs a pull request needs, by its diff from the
// merge base. Every other event (a push to main, a tag) runs everything. It
// fails toward running: anything it cannot classify, and any error, selects
// everything. The workflow does not call it at all when a pull request
// changes .github/workflows or scripts/ci, so it never judges its own edits.
//
//   node scripts/ci/classify-changes.mjs            # CI: reads GITHUB_* env, writes GITHUB_OUTPUT
//   node scripts/ci/classify-changes.mjs <base-sha> # locally: print what a diff from <base-sha> runs
//
// Rules, first match per path:
//   packages/<dir>/**              that package; jobs run when a package they exercise
//                                  (or one of its dependencies) changed
//   e2e/**, playwright.*           the e2e job
//   docs/**, top-level *.md, .claude/**, .github/ISSUE_TEMPLATE/**,
//   .github/PULL_REQUEST_TEMPLATE.md, .github/dependabot.yml, LICENSE
//                                  only the unit tests that read the file
//   anything else                  everything (root config, workflows, docker/, scripts/)
//
// A unit test "reads" a non-package file when its source names the path
// (`docs/user/connector-reference.md`), a directory above it (`docs/user/`),
// or the quoted segment `'docs'` (as in `join(root, 'docs', name)`). Only
// *.test.ts(x) files are scanned: a helper that holds the path hides it.
// A test that uses the server's `readRepoFile`/`REPO_ROOT` can read any path a
// doc names (the capabilities guard checks its proof files exist), so it runs
// on every classified change whose gate does not already run its package.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Every job in ci.yml. classify-changes.test.mjs fails when they differ. */
export const CI_JOBS = ['changes', 'build-lint-test', 'connector-integration', 'e2e', 'docs', 'ci-ok'];

/** The root `gate` script. CI runs the same steps with a narrower test filter. */
export const GATE_COMMAND = 'pnpm build && pnpm lint && pnpm test:coverage && pnpm test:ci';

/** The packages each lane exercises. A lane runs when one of these, or a dependency, changed. */
const LANE_ROOTS = {
  connectorIntegration: ['@galvaniflow/connectors'],
  pgIntegration: ['@galvaniflow/server'],
  e2e: ['@galvaniflow/server', '@galvaniflow/web'],
};

const E2E_PATH = /^(e2e\/|playwright\.[^/]+$)/;
const READ_ONLY_PATH =
  /^(docs\/|\.claude\/|\.github\/ISSUE_TEMPLATE\/|\.github\/PULL_REQUEST_TEMPLATE\.md$|\.github\/dependabot\.yml$|LICENSE$|[^/]+\.md$)/;
const PACKAGE_PATH = /^packages\/([^/]+)\//;
const TEST_FILE = /^packages\/[^/]+\/.*\.test\.tsx?$/;
const REPO_READER = /\b(REPO_ROOT|readRepoFile)\b/;

/**
 * Workspace packages by directory, with their workspace dependencies.
 * @param {string} root repository root
 * @returns {Map<string, { name: string, deps: string[] }>}
 */
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

/**
 * Tracked unit test files and their source.
 * @param {string} root repository root
 * @returns {{ path: string, source: string }[]}
 */
export function readWorkspaceTestSources(root) {
  const files = execFileSync('git', ['ls-files', 'packages'], { cwd: root, encoding: 'utf8' }).split('\n');
  return files.filter((f) => TEST_FILE.test(f)).map((path) => ({ path, source: readFileSync(join(root, path), 'utf8') }));
}

/** The repository paths a test's source names. */
function pathsNamed(source) {
  const named = [...source.matchAll(/(?:docs|e2e|\.claude|\.github)\/[\w./-]*/g)].map((m) => m[0]);
  const topLevelMd = [...source.matchAll(/\b[A-Z][A-Za-z_-]*\.md\b/g)].map((m) => m[0]);
  const segments = [...source.matchAll(/['"`](docs|e2e|\.claude|\.github)['"`]/g)].map((m) => `${m[1]}/`);
  return [...named, ...topLevelMd, ...segments];
}

/**
 * The tests whose source names one of the changed paths, or a directory above it.
 * @param {string[]} changed repository paths
 * @param {{ path: string, source: string }[]} testSources
 */
export function findReaders(changed, testSources) {
  return testSources.filter(({ source }) => {
    const named = pathsNamed(source);
    return changed.some((path) => named.some((n) => path === n || (n.endsWith('/') && path.startsWith(n))));
  });
}

/** Names of `roots` and everything they depend on, transitively. */
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

/** Names of `changed` and every package that depends on one of them, transitively. */
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

/**
 * Decide which CI jobs a set of changed paths needs.
 * @param {{ changed: string[], packages: Map<string, { name: string, deps: string[] }>, testSources: { path: string, source: string }[] }} input
 */
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

/** Test files grouped by package, with the package's directory and paths relative to it. */
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

/**
 * The commit to diff against, or null to run everything. Only a pull request
 * narrows. A push to main runs everything: nobody waits on it, it is the
 * backstop for what two green pull requests break together, and a force push
 * would otherwise hide the commits it replaced.
 * @param {string} root repository root
 * @param {Record<string, string | undefined>} env GITHUB_* variables
 * @param {string[]} argv a base given on the command line wins
 */
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
    'doc_tests<<GALVANIFLOW_EOF',
    ...result.docTests.map((t) => `${t.dir} ${t.files.join(' ')}`),
    'GALVANIFLOW_EOF',
  ];
  appendFileSync(file, `${lines.join('\n')}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const result = decide(root, process.env, process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) writeOutputs(result, process.env.GITHUB_OUTPUT);
}
