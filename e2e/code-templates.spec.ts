// ===========================================
// Code Templates E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER, TEST_LIBRARY, TEST_TEMPLATE } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';

test.describe('Code Templates', () => {
  // Clean up stale test data from previous runs
  test.beforeAll(async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    const loginRes = await ctx.post('/auth/login', {
      data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
    });
    const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
    const token = loginBody.data.accessToken;

    const libRes = await ctx.get('/code-templates/libraries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (libRes.ok()) {
      const libBody = await libRes.json() as { success: boolean; data: Array<{ id: string; name: string }> };
      for (const lib of libBody.data) {
        if (lib.name === TEST_LIBRARY.name) {
          await ctx.delete(`/code-templates/libraries/${lib.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
    }
    await ctx.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Code Templates page', async ({ page }) => {
    await page.goto('/code-templates');
    await expect(page.getByRole('heading', { name: 'Code Templates' })).toBeVisible();
  });

  test('create library', async ({ page }) => {
    await page.goto('/code-templates');

    // Click Library button
    await page.getByRole('button', { name: /library/i }).click();

    // Fill in library details
    await page.getByLabel('Name').fill(TEST_LIBRARY.name);
    const descField = page.getByLabel('Description');
    if (await descField.isVisible()) {
      await descField.fill(TEST_LIBRARY.description);
    }

    await page.getByRole('button', { name: /create/i }).click();

    // Library should appear in tree
    await expect(page.getByText(TEST_LIBRARY.name)).toBeVisible({ timeout: 10_000 });
  });

  test('create template in library', async ({ page }) => {
    await page.goto('/code-templates');

    // Wait for library to load
    await expect(page.getByText(TEST_LIBRARY.name)).toBeVisible({ timeout: 10_000 });

    // Click Template button
    await page.getByRole('button', { name: /template/i }).click();

    // New template should appear
    await expect(page.getByText('New Template')).toBeVisible({ timeout: 10_000 });
  });

  test('edit template code and contexts', async ({ page }) => {
    await page.goto('/code-templates');

    // Wait for templates to load
    await page.waitForTimeout(2_000);

    // Click on a template in the tree
    const templateItem = page.getByText('New Template');
    if (await templateItem.isVisible()) {
      await templateItem.click();

      // Edit name
      const nameField = page.getByLabel('Name');
      if (await nameField.isVisible()) {
        await nameField.clear();
        await nameField.fill(TEST_TEMPLATE.name);
      }

      // Toggle a context checkbox
      const checkbox = page.getByLabel(/Source Filter/i);
      if (await checkbox.isVisible()) {
        await checkbox.check();
      }

      // Click save
      await page.getByRole('button', { name: /save/i }).click();
      await page.waitForTimeout(1_000);
    }
  });

  test('delete template', async ({ page }) => {
    await page.goto('/code-templates');
    await page.waitForTimeout(2_000);

    const templateItem = page.getByText(TEST_TEMPLATE.name);
    if (await templateItem.isVisible()) {
      await templateItem.click();

      // Handle confirm dialog
      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      await page.getByRole('button', { name: /delete/i }).last().click();
      await page.waitForTimeout(1_000);
    }
  });

  test('delete library', async ({ page }) => {
    await page.goto('/code-templates');
    await page.waitForTimeout(2_000);

    // Handle confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Find the delete button on the library row
    const libRow = page.getByText(TEST_LIBRARY.name);
    if (await libRow.isVisible()) {
      // The delete icon is in the same list item
      const deleteBtn = page.locator('button', { has: page.locator('[data-testid="DeleteIcon"]') }).first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(1_000);
      }
    }
  });
});
