// ===========================================
// Channel Groups E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_GROUP_NAME = 'E2E Test Group';

test.describe('Channel Groups', () => {
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

      const groupRes = await ctx.get('/channel-groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (groupRes.ok()) {
        const groupBody = await groupRes.json() as {
          success: boolean;
          data: Array<{ id: string; name: string }>;
        };
        const groups = Array.isArray(groupBody.data) ? groupBody.data : [];
        for (const group of groups) {
          if (group.name.startsWith(TEST_GROUP_NAME)) {
            await ctx.delete(`/channel-groups/${group.id}`, {
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

  // Channel groups live on the Dashboard (New Group button + grouped view);
  // the standalone /channel-groups page was folded in there.
  test('create a new channel group from the dashboard', async ({ page }) => {
    await page.getByRole('button', { name: 'New Group' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Group' });
    await dialog.getByLabel('Name').fill(TEST_GROUP_NAME);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'grouped view' }).click();
    await expect(page.getByText(`${TEST_GROUP_NAME} (0)`)).toBeVisible({ timeout: 10_000 });
  });

  test('rename group', async ({ page }) => {
    await page.getByRole('button', { name: 'grouped view' }).click();
    await page.getByRole('button', { name: `Group actions for ${TEST_GROUP_NAME}` }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const dialog = page.getByRole('dialog', { name: 'Rename Group' });
    await dialog.getByLabel('Name').fill(`${TEST_GROUP_NAME} Updated`);
    await dialog.getByRole('button', { name: 'Rename' }).click();

    await expect(page.getByText(`${TEST_GROUP_NAME} Updated (0)`)).toBeVisible({ timeout: 10_000 });
  });

  test('delete group with confirmation', async ({ page }) => {
    const name = `${TEST_GROUP_NAME} Updated`;
    await page.getByRole('button', { name: 'grouped view' }).click();
    await page.getByRole('button', { name: `Group actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await page.getByRole('dialog', { name: 'Delete Group' }).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(`${name} (0)`)).not.toBeVisible({ timeout: 10_000 });
  });
});
