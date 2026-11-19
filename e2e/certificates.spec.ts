import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_CERT_NAME = 'E2E Test Certificate';
const TEST_CERT_DESCRIPTION = 'Created by E2E test';
const INVALID_CERT_NAME = `${TEST_CERT_NAME} Invalid`;

// Real self-signed certificate, valid until 2036: the server parses it with node:crypto on create.
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

interface CertificateSummary { readonly id: string; readonly name: string; readonly type: string }

let api: APIRequestContext;

// The list endpoint returns a bare array, not a page.
async function testCertificates(): Promise<CertificateSummary[]> {
  const certs = await getData<CertificateSummary[]>(api, '/certificates');
  return certs.filter((c) => c.name.startsWith(TEST_CERT_NAME));
}

function certRow(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

async function openCertificates(page: Page): Promise<void> {
  await page.goto('/certificates');
  await expect(page.getByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible({ timeout: 10_000 });
}

test.describe('Certificates', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const cert of await testCertificates()) {
      await deleteOk(api, `/certificates/${cert.id}`);
    }
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to certificates page', async ({ page }) => {
    await openCertificates(page);
    for (const column of ['Name', 'Type', 'Subject', 'Issuer', 'Expiry', 'Actions']) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add Certificate' })).toBeEnabled();
  });

  test('create (import) a new certificate', async ({ page }) => {
    await openCertificates(page);
    await page.getByRole('button', { name: 'Add Certificate' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Certificate' })).toBeVisible();
    await dialog.getByLabel('Name').fill(TEST_CERT_NAME);
    await dialog.getByLabel('Description').fill(TEST_CERT_DESCRIPTION);
    // Type defaults to CA.
    await dialog.getByLabel('Certificate PEM').fill(TEST_CERT_PEM);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(certRow(page, TEST_CERT_NAME)).toHaveCount(1);
    await expect.poll(async () => (await testCertificates()).map((c) => `${c.name}:${c.type}`))
      .toEqual([`${TEST_CERT_NAME}:CA`]);
  });

  test('new certificate appears in list', async ({ page }) => {
    await openCertificates(page);
    const row = certRow(page, TEST_CERT_NAME);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(TEST_CERT_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(row.getByText('CA', { exact: true })).toBeVisible();
    // Subject and issuer both carry the self-signed CN.
    await expect(row.getByText(/mirthless-e2e-test/)).toHaveCount(2);
    await expect(row.getByText(/^\d+d remaining$/)).toBeVisible();
  });

  test('invalid PEM is rejected on create', async ({ page }) => {
    await openCertificates(page);
    await page.getByRole('button', { name: 'Add Certificate' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(INVALID_CERT_NAME);
    await dialog.getByLabel('Certificate PEM').fill('not a valid pem');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog.getByRole('alert').filter({ hasText: /invalid|parse/i })).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(certRow(page, INVALID_CERT_NAME)).toHaveCount(0);
    expect((await testCertificates()).map((c) => c.name)).not.toContain(INVALID_CERT_NAME);
  });

  test('delete certificate with confirmation', async ({ page }) => {
    await openCertificates(page);
    const row = certRow(page, TEST_CERT_NAME);
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Delete certificate' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(`"${TEST_CERT_NAME}"`);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden({ timeout: 10_000 });
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await testCertificates()).length).toBe(0);
  });

  test('empty state shown when there are no certificates', async ({ page }) => {
    // The database is shared with other specs, so stub the list instead of relying on it being empty.
    await page.route('**/api/v1/certificates*', (route) => route.fulfill({ json: { success: true, data: [] } }));
    await openCertificates(page);
    await expect(page.getByText('No certificates yet', { exact: true })).toBeVisible();
    await expect(page.getByText('Add an SSL/TLS certificate to secure your connectors.')).toBeVisible();
  });
});
