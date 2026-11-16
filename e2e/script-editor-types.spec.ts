// ===========================================
// Script editor type check E2E (#206)
// ===========================================
// The editor checks a TypeScript script as the body of the function the engine
// runs it in, so a type error inside a top-level `return` is reported, as the
// deploy check reports it. Nothing is saved: the global scripts are
// server-wide, and this spec only types into the editor (D-289).

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Script editor type check', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('reports a type error in a top-level return expression and clears it when fixed', async ({ page }) => {
    await page.goto('/global-scripts');
    const editor = page.locator('.monaco-editor').first();
    await expect(editor.locator('.view-line').first()).toBeVisible();
    // The deploy script runs without a message, so `msg` is not declared there.
    await page.getByRole('button', { name: 'TypeScript', exact: true }).click();
    await editor.click();
    await page.keyboard.press('Control+a');
    // One edit, not key by key: typing raced the editor's auto-closing brackets.
    await page.keyboard.insertText("return [msg.get('MSH.10')];");
    await expect(page.getByText("Line 1: Cannot find name 'msg'.")).toBeVisible();

    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('return [channelName];');
    await expect(page.getByText("Cannot find name 'msg'.")).toBeHidden();
    await expect(page.getByText('No problems')).toBeVisible();
  });
});
