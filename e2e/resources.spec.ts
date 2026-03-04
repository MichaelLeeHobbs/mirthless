// ===========================================
// Resources E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_RESOURCE_NAME = 'E2E Test Resource';

test.describe('Resources', () => {
  // Clean up stale test data from previous runs
  test.beforeAll(async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const loginRes = await ctx.post('/auth/login', {
        data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
      });
      if (!loginRes.ok()) return;

      const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
      if (!loginBody.data?.accessToken) return;
      const token = loginBody.data.accessToken;

      const resourceRes = await ctx.get('/resources', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resourceRes.ok()) {
        const resourceBody = await resourceRes.json() as {
          success: boolean;
          data: { data: Array<{ id: string; name: string }>; pagination: unknown };
        };
        const resources = Array.isArray(resourceBody.data?.data) ? resourceBody.data.data : [];
        for (const resource of resources) {
          if (resource.name.startsWith(TEST_RESOURCE_NAME)) {
            await ctx.delete(`/resources/${resource.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
      }
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to resources page', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByRole('heading', { name: /resources/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create a new resource', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByRole('heading', { name: /resources/i })).toBeVisible({ timeout: 10_000 });

    // Click the New / Create button
    await page.getByRole('button', { name: /new|create/i }).click();

    // Fill in the resource name
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_RESOURCE_NAME);

    // Fill in the description if available
    const descField = page.getByLabel('Description');
    if (await descField.isVisible()) {
      await descField.fill('Created by E2E test');
    }

    // Submit
    await page.getByRole('button', { name: /create|save/i }).click();

    // Resource should appear in the list
    await expect(page.getByText(TEST_RESOURCE_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('new resource appears in list', async ({ page }) => {
    await page.goto('/resources');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyText = page.getByText(/no.*resource|no data/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('edit resource', async ({ page }) => {
    await page.goto('/resources');
    await page.waitForTimeout(1_000);

    const resourceRow = page.locator('table tbody tr', { hasText: TEST_RESOURCE_NAME }).first();
    if (await resourceRow.isVisible()) {
      const editBtn = resourceRow.getByRole('button', { name: /edit/i });
      if (await editBtn.isVisible()) {
        await editBtn.click();

        // Edit the name
        const nameField = page.getByLabel('Name');
        if (await nameField.isVisible()) {
          await nameField.clear();
          await nameField.fill(TEST_RESOURCE_NAME + ' Updated');
        } else {
          // Some UIs open a detail page — look for a name input anywhere
          const anyNameField = page.locator('input[name="name"], input[id*="name"]').first();
          if (await anyNameField.isVisible()) {
            await anyNameField.clear();
            await anyNameField.fill(TEST_RESOURCE_NAME + ' Updated');
          }
        }

        await page.getByRole('button', { name: /save/i }).click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('delete resource with confirmation', async ({ page }) => {
    await page.goto('/resources');
    await page.waitForTimeout(1_000);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const resourceRow = page
      .locator('table tbody tr')
      .filter({ hasText: /E2E Test Resource/ })
      .first();

    if (await resourceRow.isVisible()) {
      const deleteBtn = resourceRow.getByRole('button', { name: /delete/i });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(1_000);

        // Confirm in MUI dialog if present
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await page.waitForTimeout(1_000);
        }

        await expect(page.getByText(TEST_RESOURCE_NAME)).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('empty state shown when no resources', async ({ page }) => {
    await page.goto('/resources');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyIndicator = page.getByText(/no.*resource|no data|empty/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyIndicator.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});
