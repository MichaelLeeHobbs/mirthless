// ===========================================
// User Management E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { TEST_USER } from './fixtures/test-data.js';

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Users page', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByText('Users')).toBeVisible();
  });

  test('create new user', async ({ page }) => {
    await page.goto('/users');

    // Click create button
    await page.getByRole('button', { name: /new|create|add/i }).click();

    // Fill in user details
    await page.getByLabel('Username').fill(TEST_USER.username);
    await page.getByLabel('Email').fill(TEST_USER.email);
    await page.getByLabel('Password').fill(TEST_USER.password);

    const firstNameField = page.getByLabel('First Name');
    if (await firstNameField.isVisible()) {
      await firstNameField.fill(TEST_USER.firstName);
    }

    const lastNameField = page.getByLabel('Last Name');
    if (await lastNameField.isVisible()) {
      await lastNameField.fill(TEST_USER.lastName);
    }

    // Submit
    await page.getByRole('button', { name: /create|save/i }).click();

    // User should appear in list
    await expect(page.getByText(TEST_USER.username)).toBeVisible({ timeout: 10_000 });
  });

  test('edit user role', async ({ page }) => {
    await page.goto('/users');

    // Find user row and click edit
    const userRow = page.locator('table tbody tr', { hasText: TEST_USER.username });
    if (await userRow.isVisible()) {
      const editBtn = userRow.getByRole('button', { name: /edit/i });
      if (await editBtn.isVisible()) {
        await editBtn.click();

        // Change role if dropdown visible
        const roleSelect = page.getByLabel('Role');
        if (await roleSelect.isVisible()) {
          await roleSelect.click();
          await page.getByRole('option', { name: /developer/i }).click();
        }

        await page.getByRole('button', { name: /save/i }).click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('disable user', async ({ page }) => {
    await page.goto('/users');

    const userRow = page.locator('table tbody tr', { hasText: TEST_USER.username });
    if (await userRow.isVisible()) {
      const disableBtn = userRow.getByRole('button', { name: /disable|deactivate/i });
      if (await disableBtn.isVisible()) {
        await disableBtn.click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('unlock user', async ({ page }) => {
    await page.goto('/users');

    const userRow = page.locator('table tbody tr', { hasText: TEST_USER.username });
    if (await userRow.isVisible()) {
      const unlockBtn = userRow.getByRole('button', { name: /unlock/i });
      if (await unlockBtn.isVisible()) {
        await unlockBtn.click();
        await page.waitForTimeout(1_000);
      }
    }
  });
});
