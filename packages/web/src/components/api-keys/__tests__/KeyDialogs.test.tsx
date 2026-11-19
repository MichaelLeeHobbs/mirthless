import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { lightTheme } from '../../../styles/theme.js';

vi.mock('../../../hooks/use-channel-groups.js', () => ({
  useChannelGroups: () => ({ data: [{ id: 'g1', name: 'Lab' }] }),
}));

import { KeyTokenDialog } from '../KeyTokenDialog.js';
import { IssueKeyDialog } from '../IssueKeyDialog.js';
import { OffboardKeysDialog } from '../../users/OffboardKeysDialog.js';

function themed(node: ReactNode): void {
  render(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TOKEN = `gf_0f8fad5b-d9cb-469f-a165-70867728950e_${'a'.repeat(43)}`;

describe('KeyTokenDialog', () => {
  it('shows the token and closes only with Done, not with Escape', () => {
    const onClose = vi.fn();
    themed(<KeyTokenDialog shown={{ name: 'Feed', token: TOKEN, oldSecretUntil: null }} onClose={onClose} />);
    expect((screen.getByLabelText('Token') as HTMLTextAreaElement).value).toBe(TOKEN);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says so when the browser will not copy, so the token can be copied by hand', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    themed(<KeyTokenDialog shown={{ name: 'Feed', token: TOKEN, oldSecretUntil: null }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/Select the token and copy it yourself/)).toBeTruthy();
  });

  it('says when the old token stops after a planned replace', () => {
    themed(<KeyTokenDialog shown={{ name: 'Feed', token: TOKEN, oldSecretUntil: '2026-11-24T12:00:00.000Z' }} onClose={vi.fn()} />);
    expect(screen.getByText(/The old token keeps working until/)).toBeTruthy();
  });
});

describe('OffboardKeysDialog', () => {
  const keys = [
    { id: 'k1', name: 'Lab feed', permissions: ['channels:read'] },
    { id: 'k2', name: 'CI deploys', permissions: ['channels:deploy'] },
  ] as never;
  const open = (over: Partial<Parameters<typeof OffboardKeysDialog>[0]> = {}): ReturnType<typeof vi.fn> => {
    const onConfirm = vi.fn();
    themed(<OffboardKeysDialog target={{ username: 'jmorales', keys }} canTakeOver={() => true} isPending={false} error={null} onConfirm={onConfirm} onCancel={vi.fn()} {...over} />);
    return onConfirm;
  };

  it('warns that every key stops, names them, and takes none over unless asked', () => {
    const onConfirm = open();
    expect(screen.getByText(/2 API keys they issued will stop now/)).toBeTruthy();
    expect(screen.getByText('Lab feed')).toBeTruthy();
    expect(screen.getByText('CI deploys')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('sends the keys taken over', () => {
    const onConfirm = open();
    fireEvent.click(screen.getByLabelText('Take ownership of CI deploys'));
    expect(screen.getByText(/1 API key they issued will stop now/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledWith(['k2']);
  });

  it('offers no take-over for a key the admin does not cover, and shows a refusal', () => {
    open({ canTakeOver: (k: { id: string }) => k.id === 'k1', error: 'A key cannot outlast your own access' } as never);
    expect(screen.queryByLabelText('Take ownership of CI deploys')).toBeNull();
    expect(screen.getByLabelText('Take ownership of Lab feed')).toBeTruthy();
    expect(screen.getByText(/cannot outlast your own access/)).toBeTruthy();
  });
});

describe('IssueKeyDialog', () => {
  it('shows a refusal and keeps what was typed', async () => {
    const onIssue = vi.fn();
    themed(<IssueKeyDialog open saving={false} error="You can only give this key on every channel where you hold its permissions." onIssue={onIssue} onClose={vi.fn()} />);
    expect(screen.getByText(/where you hold its permissions/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Feed' } });
    await waitFor(() => { expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Feed'); });
  });

  it('cannot be sent until it names permissions and an end', () => {
    themed(<IssueKeyDialog open saving={false} error={null} onIssue={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Feed' } });
    expect((screen.getByRole('button', { name: 'Issue key' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
