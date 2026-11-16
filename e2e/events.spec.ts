// ===========================================
// Events E2E Tests
// ===========================================
// The audit log browser: the login every test makes is an event of its own,
// so these tests read real rows without creating any. Other specs add events
// in parallel, so nothing here depends on which rows are on the first page.

import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';

/** Pick an option from one of the filter bar's selects and wait for the filtered list. */
async function chooseFilter(page: Page, label: string, option: string, query: string): Promise<void> {
  const select = page.getByRole('combobox', { name: label, exact: true });
  const filtered = page.waitForResponse((res) => res.url().includes('/api/v1/events?') && res.url().includes(query));
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  expect((await filtered).ok()).toBeTruthy();
}

/** The cells of one column of the event table's summary rows (each event also has a hidden detail row). */
function columnCells(page: Page, column: number): ReturnType<Page['locator']> {
  return page.locator('table tbody tr:has(button[aria-label$="event details"])').locator(`td:nth-child(${String(column)})`);
}

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to events page', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible();
  });

  test('events from login appear', async ({ page }) => {
    await page.goto('/events');
    await chooseFilter(page, 'Event Name', 'User login', 'name=USER_LOGIN');

    // This test's own login is among them, so the filtered list is never empty.
    const events = columnCells(page, 4);
    await expect(events.first()).toHaveText('User login');
    await expect.poll(async () => new Set(await events.allTextContents())).toEqual(new Set(['User login']));
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
    await chooseFilter(page, 'Level', 'Info', 'level=INFO');

    // Logins are INFO events, so the filtered list has rows, and every row is INFO.
    const levels = columnCells(page, 3);
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
