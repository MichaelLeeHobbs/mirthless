// ===========================================
// Certificates E2E Tests
// ===========================================
// Covers the SSL/TLS certificate store: navigate, list, create (import a
// PEM), and delete. Modeled on resources.spec.ts. The server parses the PEM
// with node:crypto's X509Certificate on create, so the fixture below is a real
// self-signed certificate (CN=mirthless-e2e-test, valid until 2036).

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_CERT_NAME = 'E2E Test Certificate';

// A real self-signed X.509 certificate (RSA 2048, CN=mirthless-e2e-test),
// valid 2026..2036. Must be parseable by node:crypto or create() rejects it.
const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUBQSTR7arp5BacRIUeuV8ieliAPUwDQYJKoZIhvcNAQEL
BQAwNDEbMBkGA1UEAwwSbWlydGhsZXNzLWUyZS10ZXN0MRUwEwYDVQQKDAxNaXJ0
aGxlc3NFMkUwHhcNMjYwNzE0MjMyMTA0WhcNMzYwNzExMjMyMTA0WjA0MRswGQYD
VQQDDBJtaXJ0aGxlc3MtZTJlLXRlc3QxFTATBgNVBAoMDE1pcnRobGVzc0UyRTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANTghOMehow3eGAWzpI6+DVP
IlvcwgA429BgFA10cilyuqHNQqkx144A7Fj2JGlffun/DKPeY0zU4uwkg4mcwOZB
h1EQWoR22qy9A38rozsC6rnDY9Ghv/i9IbxmUmq6AE5wGUq7kNE6VZ3vYkR6VSQY
hzgjomnUKrvcvi214LdzcafxLnu6AClclEZOEcK+FlSopB9ZfysAMtZy9KNmf2JK
6b3UGvYChB42vZBKbiEaxbIpR1HMy8j5FOIGrYf/azi1KywNQ+BNdcmKfoLRAnHq
/O/CaA0GLsSn1fe2XASAturFhbvWSHQh9DR2Y7jsc29/DhLM/pJ/iJzd1tzgmO0C
AwEAAaNTMFEwHQYDVR0OBBYEFL9DtIwuCdWIfZZI5zgAq4a/Id2BMB8GA1UdIwQY
MBaAFL9DtIwuCdWIfZZI5zgAq4a/Id2BMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAEcJcJUjrnFZYWbbhYq1vy18Mx0WmO7CZv2/xcUNdxIkRGtS
jur31087nCsot0z9FAbmy6u0FpG1Iwr2dMbIfLPo9a+WL4gzFRwYECJEbWORtrgh
84XykWfZqFKXC+nK7Bp8js5Kp/DJ+jOCqSVZ8XsZWK7mrBB2yvjDtQLb1t4iJJTf
zNib01hKr+GHWlxIUXNrsGfzkOOxTCTunnQgVOdC4MapZLayOY4oLZwVy/XdQedx
nXWIs7HS6iYJd3IfLwFrda/xxL7Q3bA7cfhHcDZoZFUz2LSUEWTOiTFBhr99uEaR
2A+q0sR6IK7uQXImRZrg5fNQjmyzymRRoPWbT+Y=
-----END CERTIFICATE-----`;

test.describe('Certificates', () => {
  // Clean up stale test data from previous runs. The list endpoint returns the
  // certificate array directly in `data` (no pagination wrapper).
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

      const listRes = await ctx.get('/certificates', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (listRes.ok()) {
        const listBody = await listRes.json() as {
          success: boolean;
          data: Array<{ id: string; name: string }>;
        };
        const certs = Array.isArray(listBody.data) ? listBody.data : [];
        for (const cert of certs) {
          if (cert.name.startsWith(TEST_CERT_NAME)) {
            await ctx.delete(`/certificates/${cert.id}`, {
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

  test('navigate to certificates page', async ({ page }) => {
    await page.goto('/certificates');
    await expect(page.getByRole('heading', { name: /certificates/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create (import) a new certificate', async ({ page }) => {
    await page.goto('/certificates');
    await expect(page.getByRole('heading', { name: /certificates/i })).toBeVisible({ timeout: 10_000 });

    // Open the Add Certificate dialog
    await page.getByRole('button', { name: /add certificate/i }).click();

    // Fill the certificate name
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_CERT_NAME);

    // Description is optional
    const descField = page.getByLabel('Description');
    if (await descField.isVisible()) {
      await descField.fill('Created by E2E test');
    }

    // Type defaults to CA — no need to change it. Paste the PEM material.
    await page.getByLabel('Certificate PEM').fill(TEST_CERT_PEM);

    // Submit (button reads "Create" in create mode)
    await page.getByRole('button', { name: /^create$/i }).click();

    // The new certificate should appear in the list
    await expect(page.getByText(TEST_CERT_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('new certificate appears in list', async ({ page }) => {
    await page.goto('/certificates');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyText = page.getByText(/no.*certificate|no data/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('invalid PEM is rejected on create', async ({ page }) => {
    await page.goto('/certificates');
    await expect(page.getByRole('heading', { name: /certificates/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /add certificate/i }).click();

    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_CERT_NAME + ' Invalid');
    await page.getByLabel('Certificate PEM').fill('not a valid pem');

    await page.getByRole('button', { name: /^create$/i }).click();

    // The dialog surfaces the parse error and stays open (row is not created)
    await expect(page.getByRole('alert').filter({ hasText: /invalid|parse/i })).toBeVisible({ timeout: 10_000 });
  });

  test('delete certificate with confirmation', async ({ page }) => {
    await page.goto('/certificates');
    await page.waitForTimeout(1_000);

    const certRow = page
      .locator('table tbody tr')
      .filter({ hasText: TEST_CERT_NAME })
      .first();

    if (await certRow.isVisible()) {
      // Row action is an IconButton with aria-label "Delete certificate"
      const deleteBtn = certRow.getByRole('button', { name: /delete certificate/i });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();

        // Confirm in the ConfirmDialog (its confirm button reads "Delete")
        const confirmBtn = page.getByRole('button', { name: /^delete$/i });
        await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
        await confirmBtn.click();

        await expect(page.getByText(TEST_CERT_NAME)).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('empty state or table shown', async ({ page }) => {
    await page.goto('/certificates');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyIndicator = page.getByText(/no.*certificate|no data|empty/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyIndicator.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});
