#!/usr/bin/env node
// ===========================================
// Migration scenario suite: run and score
// ===========================================
// 1. Recreates the scenario database (SCENARIO_DATABASE_URL, must end in _test)
//    from scratch, migrates and seeds it, so every run starts from the same state.
// 2. Runs e2e/scenarios through playwright.scenarios.config.ts.
// 3. Prints each scenario's result and the weighted score, and writes
//    tmp/feature-climb/score.json.
//
// Usage: node scripts/scenarios/run.mjs [--no-reset] [-- <extra playwright args>]
// Needs Docker test services: docker compose -f docker/docker-compose.yml --profile test up -d sftp-test mail-test mysql-test

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import pg from 'pg';

const url = process.env.SCENARIO_DATABASE_URL;
if (!url || !/_test$/i.test(new URL(url).pathname)) {
  console.error('SCENARIO_DATABASE_URL must point at a *_test database.');
  process.exit(2);
}
const args = process.argv.slice(2);
const sep = args.indexOf('--');
const extra = sep === -1 ? [] : args.slice(sep + 1);
const reset = !args.includes('--no-reset');
const shell = process.platform === 'win32';

async function recreateDatabase() {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  const env = { ...process.env, DATABASE_URL: url, JWT_SECRET: 'scenario-suite-jwt-secret-not-for-production-use' };
  execFileSync('pnpm', ['--filter', '@galvaniflow/server', 'exec', 'drizzle-kit', 'migrate'], { env, stdio: 'inherit', shell });
  // The seed exits non-zero after seeding when optional pieces need settings this
  // throwaway database lacks; the admin user and settings are what the suite needs.
  spawnSync('pnpm', ['--filter', '@galvaniflow/server', 'exec', 'tsx', 'src/db/seeds/run-seed.ts'], { env, stdio: 'inherit', shell });
}

if (reset) await recreateDatabase();

mkdirSync('tmp/feature-climb', { recursive: true });
if (existsSync('tmp/feature-climb/results.json')) rmSync('tmp/feature-climb/results.json');
spawnSync('npx', ['playwright', 'test', '-c', 'playwright.scenarios.config.ts', ...extra], { stdio: 'inherit', shell, env: process.env });

const manifest = JSON.parse(readFileSync('e2e/scenarios/manifest.json', 'utf8')).scenarios;
const outcome = new Map();
if (existsSync('tmp/feature-climb/results.json')) {
  const report = JSON.parse(readFileSync('tmp/feature-climb/results.json', 'utf8'));
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = /^(S\d\d)\b/.exec(spec.title)?.[1];
      if (!id) continue;
      const results = spec.tests.flatMap((t) => t.results);
      const passed = results.length > 0 && results.every((r) => r.status === 'passed');
      const error = results.flatMap((r) => r.errors ?? []).map((e) => (e.message ?? '').split('\n')[0]).find(Boolean) ?? '';
      outcome.set(id, { passed, error: error.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 220) });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
}

let total = 0;
let earned = 0;
const rows = manifest.map((s) => {
  const o = outcome.get(s.id) ?? { passed: false, error: 'did not run' };
  total += s.weight;
  if (o.passed) earned += s.weight;
  return { ...s, ...o };
});
for (const r of rows) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id} w${r.weight}  ${r.title}${r.passed ? '' : `\n        ${r.error}`}`);
const score = Math.round((earned / total) * 1000) / 10;
console.log(`\nScore: ${String(earned)}/${String(total)} weighted = ${String(score)}%  (${String(rows.filter((r) => r.passed).length)}/${String(rows.length)} scenarios)`);
writeFileSync('tmp/feature-climb/score.json', JSON.stringify({ earned, total, score, rows }, null, 2));
