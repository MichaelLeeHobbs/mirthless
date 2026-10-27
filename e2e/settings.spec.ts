// ===========================================
// Settings E2E Tests
// ===========================================
// Against the seeded server: sections render, an edit saves and survives a
// reload, invalid values block saving, pruner settings reach the pruner
// schedule, and leaving with unsaved changes asks first. Each test puts back
// what it changed.

import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const saveBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

async function saveAndWait(page: Page, notice: string): Promise<void> {
  await saveBar(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(notice)).toBeVisible();
  await expect(saveBar(page)).toBeHidden();
}

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('shows the seeded settings in named sections', async ({ page }) => {
    for (const name of ['General', 'Email', 'Data pruning', 'Maintenance']) {
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    }
    await expect(field(page, 'Server name')).toBeVisible();
    await expect(saveBar(page)).toBeHidden();
  });

  test('saves an edit that survives a reload', async ({ page }) => {
    const original = await field(page, 'Server name').inputValue();
    await field(page, 'Server name').fill('GalvaniFlow E2E');
    await expect(saveBar(page)).toContainText('1 unsaved change');
    await saveAndWait(page, 'Setting saved');

    await page.reload();
    await expect(field(page, 'Server name')).toHaveValue('GalvaniFlow E2E');

    await field(page, 'Server name').fill(original);
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Setting saved')).toBeVisible();
  });

  test('blocks saving an invalid port and discards back to the saved value', async ({ page }) => {
    const original = await field(page, 'Port').inputValue();
    await field(page, 'Port').fill('70000');
    await expect(page.getByText('Enter a port from 1 to 65535.')).toBeVisible();
    await expect(saveBar(page).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await saveBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(field(page, 'Port')).toHaveValue(original);
  });

  test('pruner settings change the pruner schedule', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: 'Prune on a schedule' });
    const wasOn = await toggle.isChecked();
    const originalCron = await field(page, 'Schedule').inputValue();

    await field(page, 'Schedule').fill('15 2 * * *');
    await saveAndWait(page, 'Setting saved');

    const status = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('galvaniflow_auth') ?? '{}') as { accessToken?: string };
      const res = await fetch('/api/v1/admin/prune/schedule', { headers: { Authorization: `Bearer ${auth.accessToken ?? ''}` } });
      return (await res.json()) as { data: { enabled: boolean; cronExpression: string } };
    });
    expect(status.data).toMatchObject({ enabled: wasOn, cronExpression: '15 2 * * *' });

    // Restore. The snackbar drops a repeat of the same message within 1.5s, so wait on the bar instead.
    await field(page, 'Schedule').fill(originalCron);
    await saveBar(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(saveBar(page)).toBeHidden();
    await page.reload();
    await expect(field(page, 'Schedule')).toHaveValue(originalCron);
  });

  test('asks before leaving with unsaved changes', async ({ page }) => {
    await field(page, 'SMTP server').fill('smtp.unsaved.example');
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page.getByText('You have unsaved settings. Leave anyway?')).toBeVisible();
    await page.getByRole('button', { name: 'Stay' }).click();
    await expect(field(page, 'SMTP server')).toHaveValue('smtp.unsaved.example');
  });
});
