// ===========================================
// API key dialogs
// ===========================================
// The token dialog closes only with Done and says when it could not copy; the
// offboarding dialog starts at "disable" and sends the choice; the issue
// dialog keeps the form when the server refuses it and shows why.

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
  const target = { username: 'jmorales', keys: [{ id: 'k1', name: 'Lab feed' }] as never };

  it('starts at disabling the keys', () => {
    const onConfirm = vi.fn();
    themed(<OffboardKeysDialog target={target} isPending={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledWith('disable');
  });

  it('sends the 7-day choice when picked, and names the keys', () => {
    const onConfirm = vi.fn();
    themed(<OffboardKeysDialog target={target} isPending={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText(/They issued an API key: Lab feed/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Keep them working for 7 days/));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledWith('replace_within_7_days');
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
