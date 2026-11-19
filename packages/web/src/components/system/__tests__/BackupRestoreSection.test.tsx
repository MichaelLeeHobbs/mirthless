// #228: a partial restore said "Restore complete" in green, with only an error count.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ServerRestoreResult } from '@galvanigraph/core-models';
import { lightTheme } from '../../../styles/theme.js';

const restore = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock('../../../hooks/use-backup.js', () => ({
  useBackup: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useRestore: () => ({
    mutate: (_input: unknown, options: { onSuccess: (r: unknown) => void }) => { options.onSuccess(restore.result); },
    isPending: false, isError: false, error: null,
  }),
}));

const { BackupRestoreSection } = await import('../BackupRestoreSection.js');

afterEach(() => { cleanup(); });

const section = (name: string, updated: number, errors: string[] = []): ServerRestoreResult['sections'][number] =>
  ({ section: name, created: 0, updated, skipped: 0, errors });

async function restoreWith(result: ServerRestoreResult): Promise<void> {
  restore.result = result;
  render(<ThemeProvider theme={lightTheme}><BackupRestoreSection /></ThemeProvider>);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(['{"version":1}'], 'backup.json', { type: 'application/json' })] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
  // The page is hidden from assistive tech until the dialog has closed.
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
}

describe('BackupRestoreSection result', () => {
  it('says a restore with errors was partial, as a warning, and shows each error', async () => {
    const notRestored = 'The global deploy script was not restored: Could not type-check the TypeScript scripts: Type-checking took longer than 30000 ms and was stopped. Try again in a moment.';
    const asJs = 'The global undeploy script was restored as JavaScript because as TypeScript it was refused (type errors): x. Fix it and switch it back to TypeScript.';
    await restoreWith({
      sections: [section('channels', 2), section('globalScripts', 3, [notRestored, asJs])],
      totalCreated: 0, totalUpdated: 5, totalSkipped: 0, totalErrors: 2,
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('Warning');
    expect(alert.textContent).toContain('Restore partly done');
    expect(screen.queryByText(/Restore complete/)).toBeNull();
    expect(screen.getByText(notRestored)).toBeTruthy();
    expect(screen.getByText(asJs)).toBeTruthy();
  });

  it('says a restore with no errors is complete', async () => {
    await restoreWith({ sections: [section('channels', 2)], totalCreated: 0, totalUpdated: 2, totalSkipped: 0, totalErrors: 0 });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('Success');
    expect(alert.textContent).toContain('Restore complete');
  });
});
