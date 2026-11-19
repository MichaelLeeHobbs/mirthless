// Login helper for E2E tests. Uses API login to avoid hitting
// the auth rate limiter (5 req / 15 min) on every test.

import { type Page, expect } from '@playwright/test';
import { ADMIN_USER } from './test-data.js';

const STORAGE_KEY = 'galvanigraph_auth';
const API_BASE = 'http://localhost:3000/api/v1';

export async function login(
  page: Page,
  credentials?: { username: string; password: string },
): Promise<void> {
  const { username, password } = credentials ?? ADMIN_USER;

  // Call the login API directly (bypasses UI rate limiter)
  const response = await page.request.post(`${API_BASE}/auth/login`, {
    data: { username, password },
  });

  expect(response.ok(), `Login API failed: ${response.status()}`).toBeTruthy();
  const body = await response.json() as {
    success: boolean;
    data: {
      user: { id: string; username: string; email: string; role: string; permissions: readonly string[] };
      accessToken: string;
    };
  };
  expect(body.success).toBeTruthy();

  const { user, accessToken } = body.data;

  // localStorage is per origin, so load the app first.
  await page.goto('/login');

  await page.evaluate(
    ({ key, state }) => {
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key: STORAGE_KEY, state: { user, accessToken } },
  );

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 });
}
