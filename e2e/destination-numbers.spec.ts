// Queued messages, destinationSet and the statistics know a destination by its number, so the editor
// must not change one that stays (#395, D-348).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, getData, postData, removeChannelsNamed } from './fixtures/api.js';

const CHANNEL = 'E2E Destination Numbers';
const RULE = 'Only ORU';

interface Channel {
  readonly id: string;
  readonly destinations: ReadonlyArray<{ readonly id: string; readonly name: string; readonly metaDataId: number }>;
  readonly filters: ReadonlyArray<{ readonly connectorId: string | null; readonly rules: ReadonlyArray<{ readonly name: string | null }> }>;
}

let api: APIRequestContext;
let id = '';

const channel = (): Promise<Channel> => getData<Channel>(api, `/channels/${id}`);

async function saved(): Promise<unknown> {
  const { destinations, filters } = await channel();
  return destinations.map((d) => [d.name, d.metaDataId, filters.filter((f) => f.connectorId === d.id).flatMap((f) => f.rules.map((r) => r.name))]);
}

/** The destinations as the editor lists them, with the number of each saved one. */
const listed = (page: Page): Promise<string[]> =>
  page.getByRole('button', { name: /JAVASCRIPT|TCP\/MLLP/ }).evaluateAll((rows) => rows.map((row) => row.textContent));

/** Waits for the editor to have the saved channel back, or what it shows next is replaced by it. */
async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Channel saved successfully.')).toBeVisible();
}

const destination = (name: string): Record<string, unknown> => ({ name, connectorType: 'JAVASCRIPT', properties: { script: 'return msg;' } });

test.describe('Destination numbers in the channel editor', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await removeChannelsNamed(api, CHANNEL);
    ({ id } = await postData<Channel>(api, '/channels', {
      name: CHANNEL, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];' },
      destinations: [destination('Lab'), destination('Clinic'), destination('Archive')],
      filters: [{ connectorId: null, metaDataId: 2, rules: [{ enabled: true, name: RULE, operator: 'AND', type: 'JAVASCRIPT', script: 'return true;' }] }],
    }));
  });

  test.afterAll(async () => {
    await removeChannelsNamed(api, CHANNEL);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/channels/${id}`);
    await page.getByRole('tab', { name: 'Destinations' }).click();
  });

  test('a destination keeps its number and its filter when one before it is removed, and a new one gets a new number', async ({ page }) => {
    await expect.poll(() => listed(page)).toEqual(['LabJAVASCRIPT#1', 'ClinicJAVASCRIPT#2', 'ArchiveJAVASCRIPT#3']);

    // Lab is selected: it goes, and the new one ends up in its place.
    await page.getByRole('button', { name: 'remove destination' }).click();
    await page.getByRole('button', { name: 'add destination' }).click();
    await page.getByRole('button', { name: 'move destination up' }).click();
    await page.getByRole('button', { name: 'move destination up' }).click();
    await expect.poll(() => listed(page)).toEqual(['Destination 3TCP/MLLP', 'ClinicJAVASCRIPT#2', 'ArchiveJAVASCRIPT#3']);

    await save(page);

    expect(await listed(page)).toEqual(['Destination 3TCP/MLLP#4', 'ClinicJAVASCRIPT#2', 'ArchiveJAVASCRIPT#3']);
    expect(await saved()).toEqual([['Destination 3', 4, []], ['Clinic', 2, [RULE]], ['Archive', 3, []]]);
  });

  test('a second save from the same editor changes no number', async ({ page }) => {
    const before = await channel();
    await page.getByRole('button', { name: /^Archive/ }).click();
    await page.getByRole('button', { name: 'move destination up' }).click();
    await save(page);
    expect(await saved()).toEqual([['Destination 3', 4, []], ['Archive', 3, []], ['Clinic', 2, [RULE]]]);

    await page.getByRole('textbox', { name: 'Destination Name' }).fill('Vault');
    // Gone, so that the next save's own notice is the one waited for.
    await expect(page.getByText('Channel saved successfully.')).toBeHidden();
    await save(page);

    expect(await saved()).toEqual([['Destination 3', 4, []], ['Vault', 3, []], ['Clinic', 2, [RULE]]]);
    const ids = (of: Channel): string[] => of.destinations.map((d) => d.id).sort();
    expect(ids(await channel())).toEqual(ids(before));
  });
});
