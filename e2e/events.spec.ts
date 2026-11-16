// ===========================================
// Events E2E Tests
// ===========================================
// The Events page has two views: operational events (the events table) and,
// for holders of audit:read, access records (the protected audit log, D-312).
// Sign-ins are access records, so every test's own login is one. For the
// events view, beforeAll creates a tag, which writes an INFO event. Other specs
// add rows in parallel, so nothing here depends on which rows come first.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, postData } from './fixtures/api.js';

/** Pick an option from a filter select and wait for the filtered list from `endpoint`. */
async function chooseFilter(page: Page, label: string, option: string, endpoint: string, query: string): Promise<void> {
  const select = page.getByRole('combobox', { name: label, exact: true });
  const filtered = page.waitForResponse((res) => res.url().includes(`/api/v1/${endpoint}?`) && res.url().includes(query));
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  expect((await filtered).ok()).toBeTruthy();
}

/** The cells of one column of a table's summary rows (each also has a hidden detail row). */
function columnCells(page: Page, column: number, rowButton: string): ReturnType<Page['locator']> {
  return page.locator(`table tbody tr:has(button[aria-label$="${rowButton}"])`).locator(`td:nth-child(${String(column)})`);
}

let api: APIRequestContext;
let tagId: string;

test.beforeAll(async () => {
  api = await adminApi();
  const tag = await postData<{ id: string }>(api, '/tags', { name: `e2e-events-${String(Date.now())}`, color: '#336699' });
  tagId = tag.id;
});

test.afterAll(async () => {
  await deleteOk(api, `/tags/${tagId}`);
  await api.dispose();
});

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to events page', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible();
  });

  test('sign-ins appear under access records, not events', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('tab', { name: 'Access records' }).click();
    await chooseFilter(page, 'Action', 'User login', 'audit', 'action=USER_LOGIN');

    // This test's own login is among them, so the filtered list is never empty.
    const actions = columnCells(page, 3, 'record details');
    await expect(actions.first()).toHaveText('User login');
    await expect.poll(async () => new Set(await actions.allTextContents())).toEqual(new Set(['User login']));

    // The events view no longer offers sign-ins as a filter.
    await page.getByRole('tab', { name: 'Events' }).click();
    await page.getByRole('combobox', { name: 'Event Name', exact: true }).click();
    await expect(page.getByRole('option', { name: 'User login', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('expand an access record to see its details', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('tab', { name: 'Access records' }).click();
    await page.getByRole('button', { name: 'Expand record details' }).first().click();
    await expect(page.getByText('Details', { exact: true })).toBeVisible();
  });

  test('expand event detail', async ({ page }) => {
    await page.goto('/events');

    const expand = page.getByRole('button', { name: 'Expand event details' }).first();
    await expand.click();

    // The open row's button flips to Collapse, and the detail panel shows the event's fields.
    await expect(page.getByRole('button', { name: 'Collapse event details' })).toHaveCount(1);
    await expect(page.getByText('Server ID', { exact: true })).toBeVisible();
    await expect(page.getByText('Channel ID', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse event details' }).click();
    await expect(page.getByText('Server ID', { exact: true })).toBeHidden();
  });

  test('filter by level', async ({ page }) => {
    await page.goto('/events');
    await chooseFilter(page, 'Level', 'Info', 'events', 'level=INFO');

    // beforeAll's tag is an INFO event, so the filtered list has rows, and every row is INFO.
    const levels = columnCells(page, 3, 'event details');
    await expect(levels.first()).toHaveText('Info');
    await expect.poll(async () => new Set(await levels.allTextContents())).toEqual(new Set(['Info']));
  });

  test('purge dialog opens', async ({ page }) => {
    await page.goto('/events');
    // The button's tooltip gives it its accessible name.
    await page.getByRole('button', { name: 'Purge old events' }).click();

    // The dialog asks for an age in days (90 by default). Cancel closes it without purging.
    const dialog = page.getByRole('dialog', { name: 'Purge Old Events' });
    await expect(dialog.getByLabel('Days')).toHaveValue('90');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
