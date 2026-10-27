#!/usr/bin/env node
// ===========================================
// pnpm shots — screenshot the web UI against a fake API
// ===========================================
// Renders key pages signed in, in light, dark and a 390x844 phone viewport,
// with every /api/v1 call answered from ./fixture.mjs. No server or database
// is needed, only the web dev server (`pnpm dev:web`). Look at every image:
// this replaces clicking through each page by hand after a UI change.
//
//   pnpm shots                         all pages, all three variants
//   pnpm shots --only dashboard,alerts some pages
//   pnpm shots --variants dark         one variant (light | dark | phone)
//   pnpm shots --base http://localhost:5173 --out shots
//
// Prints each file it wrote, plus any page exceptions or console errors, and
// exits 1 if any page threw, so a broken render is not mistaken for a picture.

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { route } from './fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Pages to shoot: name → route, or { url, keys, type } to press keys and type
 * after load (for dialogs like the command palette), { url, click } to click the
 * element showing some text (for a record editor), or { url, fill } to fill
 * fields by their label (for a form's edited state). Add one when a page joins
 * the visual language catalog.
 */
const PAGES = {
  login: '/login',
  dashboard: '/',
  'channel-new': '/channels/new',
  'message-browser': '/channels/c1/messages',
  traffic: '/messages',
  alerts: '/alerts',
  users: '/users',
  events: '/events',
  settings: '/settings',
  'settings-edited': { url: '/settings', fill: { 'Server name': 'Mirthless (prod)', Port: '70000' } },
  system: '/system',
  'system-logs': '/system/logs',
  'system-pruner': '/system/pruner',
  tags: '/tags',
  'alert-editor': '/alerts/a1',
  'code-templates': '/code-templates',
  'global-scripts': '/global-scripts',
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

/** Every permission string the UI knows, so the fake user sees every page. */
function allPermissions() {
  const src = readFileSync(path.join(ROOT, 'packages/web/src/lib/permissions.ts'), 'utf8');
  return [...src.matchAll(/:\s*'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
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
  const { url, keys, type, click, fill } = typeof target === 'string' ? { url: target } : target;
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
  await page.route('**/api/v1/**', async (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() !== 'GET') return r.fulfill({ json: { success: true, data: null } });
    return r.fulfill({ json: { success: true, data: route(u.pathname, u.search) ?? [] } });
  });
  const signedIn = name !== 'login';
  await page.addInitScript(([auth, mode]) => {
    localStorage.setItem('mirthless_theme', mode);
    if (auth) localStorage.setItem('mirthless_auth', JSON.stringify(auth));
  }, [signedIn ? AUTH : null, v.mode]);
  await page.goto(opts.base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (keys) await page.keyboard.press(keys);
  if (type) await page.keyboard.type(type);
  if (click) await page.getByText(click, { exact: true }).first().click();
  for (const [label, value] of Object.entries(fill ?? {})) await page.getByLabel(label, { exact: true }).fill(value);
  if (keys || type || click || fill) await page.waitForTimeout(300);
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
