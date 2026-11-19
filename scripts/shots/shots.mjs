#!/usr/bin/env node
// Screenshots the web UI against the fake API in ./fixture.mjs; needs only `pnpm dev:web`.
// Exits 1 if any page threw, so a broken render is not mistaken for a picture.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
// The built package, which `pnpm dev:web` already needs.
import { PERMISSIONS } from '../../packages/core-models/dist/index.js';
import { route } from './fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Add a page when it joins the visual language catalog; shoot() reads each target's fields.
const PAGES = {
  login: '/login',
  dashboard: '/',
  'channel-new': '/channels/new',
  'channel-editor': '/channels/c1',
  'channel-destinations': { url: '/channels/c1', click: 'Destinations' },
  'channel-access': { url: '/channels/c1', click: 'Access' },
  'destination-queue': { url: '/channels/c1', click: 'Destinations', scrollTo: 'Queue Settings' },
  'source-kafka': { url: '/channels/c8', click: 'Source' },
  'destination-amqp': { url: '/channels/c8', click: 'Destinations' },
  'source-javascript': { url: '/channels/c9', click: 'Source' },
  'destination-javascript': { url: '/channels/c9', click: 'Destinations' },
  'source-delimited': { url: '/channels/c6', click: ['Source', 'Source Transformer'], scrollTo: 'Source Transformer' },
  'destination-database': { url: '/channels/c6', click: 'Destinations', scrollTo: 'Connector Settings' },
  'source-file': { url: '/channels/c6', click: 'Source', scrollTo: 'Connector Settings' },
  'message-browser': '/channels/c1/messages',
  traffic: '/messages',
  alerts: '/alerts',
  users: '/users',
  'user-edit-role': { url: '/users', click: 'Edit user' },
  // A scoped user whose temporary access ends in half an hour: the banner, and My access.
  'my-access': {
    url: '/',
    click: ['user menu', 'My access'],
    user: {
      role: 'Lab analyst',
      permissions: ['channels:read', 'messages:read', 'messages:reprocess'],
      grants: [
        { permission: 'channels:read', scope: 'all' },
        { permission: 'messages:read', scope: ['g1'] },
        { permission: 'messages:reprocess', scope: ['g1', 'g2'] },
      ],
      nextExpiryAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
  },
  roles: '/roles',
  'api-keys': '/api-keys',
  'role-editor': '/roles/r8',
  'role-admin-locked': '/roles/r1',
  'role-clone': '/roles/new?from=r4',
  events: '/events',
  'events-access': { url: '/events', click: 'Access records' },
  settings: '/settings',
  'settings-edited': { url: '/settings', fill: { 'Server name': 'GalvaniGraph (prod)', Port: '70000' } },
  system: '/system',
  'system-logs': '/system/logs',
  'system-pruner': '/system/pruner',
  // Each export and the backup ask for a reason first (D-318).
  'backup-reason': { url: '/system/backup', click: 'Download Backup' },
  'message-export-reason': { url: '/channels/c1/messages', click: ['Export', 'Export as CSV'] },
  'events-export-reason': { url: '/events', click: 'Export' },
  tags: '/tags',
  'alert-editor': '/alerts/a1',
  'alert-templates': { url: '/alerts/a1', keys: 'End' },
  'code-templates': '/code-templates',
  'library-links': { url: '/code-templates', click: 'Edit library' },
  'global-scripts': '/global-scripts',
  // Two editors with different declarations: the one not focused says types are checked when you click in.
  'channel-scripts': { url: '/channels/c1', click: ['Scripts', 'Deploy Script', 'Preprocessor'] },
  resources: '/resources',
  collections: '/collections',
  'collection-records': '/collections/k1/records',
  'collection-record-edit': { url: '/collections/k1/records', click: 'ACC20480' },
  datasources: '/datasources',
  'global-map': '/global-map',
  'config-map': '/config-map',
  certificates: '/certificates',
  extensions: '/extensions',
  'message-generator': '/tools/message-generator',
  'jump-to': { url: '/', keys: 'Control+k', type: 'ad' },
};

const VARIANTS = {
  light: { mode: 'light', viewport: { width: 1440, height: 900 } },
  dark: { mode: 'dark', viewport: { width: 1440, height: 900 } },
  phone: { mode: 'light', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 },
};

const { values: opts } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:5173' },
    out: { type: 'string', default: path.join(ROOT, 'shots') },
    only: { type: 'string' },
    variants: { type: 'string', default: 'light,dark,phone' },
  },
});

function allPermissions() {
  return Object.values(PERMISSIONS);
}

const AUTH = {
  user: { id: 'u1', username: 'admin', email: 'admin@example.test', role: 'admin', permissions: allPermissions() },
  accessToken: 'shots-fake-token',
  mustChangePassword: false,
};

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    // Cloud sandboxes ship a browser at a fixed path instead of Playwright's cache.
    if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    throw err;
  }
}

async function shoot(browser, name, target, variantName) {
  const { url, keys, type, click, fill, scrollTo, user } = typeof target === 'string' ? { url: target } : target;
  const auth = user ? { ...AUTH, user: { ...AUTH.user, ...user } } : AUTH;
  const v = VARIANTS[variantName];
  const context = await browser.newContext({
    viewport: v.viewport, isMobile: v.isMobile ?? false, deviceScaleFactor: v.deviceScaleFactor ?? 1, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`EXC ${e.message.slice(0, 200)}`));
  // The realtime socket has no fake server, so its connection errors are expected noise.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('socket.io')) problems.push(`ERR ${m.text().slice(0, 200)}`);
  });
  await page.route('**/socket.io/**', (r) => r.abort());
  // page.route does not see websockets. Without this the dev server proxies the
  // socket to whatever listens on port 3000, which refuses the fake token and
  // signs the page out.
  await page.routeWebSocket('**/socket.io/**', (ws) => { ws.close(); });
  await page.route('**/api/v1/**', async (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() !== 'GET') return r.fulfill({ json: { success: true, data: null } });
    return r.fulfill({ json: { success: true, data: route(u.pathname, u.search) ?? [] } });
  });
  const signedIn = name !== 'login';
  await page.addInitScript(([auth, mode]) => {
    localStorage.setItem('galvanigraph_theme', mode);
    if (auth) localStorage.setItem('galvanigraph_auth', JSON.stringify(auth));
  }, [signedIn ? auth : null, v.mode]);
  await page.goto(opts.base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (keys) await page.keyboard.press(keys);
  if (type) await page.keyboard.type(type);
  for (const label of [click ?? []].flat()) {
    const byText = page.getByText(label, { exact: true });
    await ((await byText.count()) > 0 ? byText : page.getByLabel(label, { exact: true })).first().click();
    await page.waitForTimeout(200);
  }
  for (const [label, value] of Object.entries(fill ?? {})) await page.getByLabel(label, { exact: true }).fill(value);
  if (scrollTo) await page.getByText(scrollTo, { exact: true }).first().evaluate((el) => { el.scrollIntoView({ block: 'start' }); });
  if (keys || type || click || fill || scrollTo) await page.waitForTimeout(300);
  const file = path.join(opts.out, `${name}.${variantName}.png`);
  await page.screenshot({ path: file });
  await context.close();
  return { file, problems };
}

const pages = opts.only ? opts.only.split(',') : Object.keys(PAGES);
const variants = opts.variants.split(',');
for (const n of pages) if (!PAGES[n]) throw new Error(`Unknown page "${n}". Pages: ${Object.keys(PAGES).join(', ')}`);
for (const n of variants) if (!VARIANTS[n]) throw new Error(`Unknown variant "${n}". Variants: ${Object.keys(VARIANTS).join(', ')}`);

mkdirSync(opts.out, { recursive: true });
const browser = await launch();
let failed = false;
try {
  for (const name of pages) {
    for (const variant of variants) {
      const { file, problems } = await shoot(browser, name, PAGES[name], variant);
      console.log(path.relative(process.cwd(), file));
      for (const p of problems) console.log(`  ${p}`);
      if (problems.some((p) => p.startsWith('EXC'))) failed = true;
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
