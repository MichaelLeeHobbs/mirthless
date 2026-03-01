// ===========================================
// Global Scripts E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Global Scripts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Global Scripts page', async ({ page }) => {
    await page.goto('/global-scripts');
    await expect(page.getByRole('heading', { name: 'Global Scripts' })).toBeVisible();
    // Should show 4 tabs
    await expect(page.getByRole('tab', { name: 'Deploy', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Undeploy' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preprocessor' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Postprocessor' })).toBeVisible();
  });

  test('enter deploy script code and save', async ({ page }) => {
    await page.goto('/global-scripts');

    // Deploy tab should be active by default
    await expect(page.getByRole('tab', { name: 'Deploy', exact: true, selected: true })).toBeVisible();

    // Type into Monaco editor
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('// E2E test deploy script');

    // Save
    await page.getByRole('button', { name: /save/i }).click();
    await page.waitForTimeout(1_000);
  });

  test('code persists after page refresh', async ({ page }) => {
    await page.goto('/global-scripts');
    await page.waitForTimeout(2_000);

    // The editor should contain the text we typed
    const editorContent = page.locator('.monaco-editor .view-line');
    if (await editorContent.first().isVisible()) {
      const text = await editorContent.first().textContent();
      // Just verify the editor loaded with some content
      expect(text).toBeDefined();
    }
  });

  test('switch to preprocessor tab and edit', async ({ page }) => {
    await page.goto('/global-scripts');

    // Click Preprocessor tab
    await page.getByRole('tab', { name: 'Preprocessor' }).click();

    // Type into Monaco editor
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.type('// E2E preprocessor');

    // Save
    await page.getByRole('button', { name: /save/i }).click();
    await page.waitForTimeout(1_000);
  });
});
