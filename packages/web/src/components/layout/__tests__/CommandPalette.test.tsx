// ===========================================
// CommandPalette Tests
// ===========================================
// Type, arrow, Enter: the palette jumps to pages, channels and actions the
// user is allowed to use. Permission and channel hooks are mocked at the API
// boundary; routing and the UI store run for real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { lightTheme } from '../../../styles/theme.js';
import { useUiStore } from '../../../stores/ui.store.js';

let granted: readonly string[] = [];

vi.mock('../../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({
    has: (p: string) => granted.includes(p),
    hasAny: (ps: readonly string[]) => ps.some((p) => granted.includes(p)),
  }),
}));

vi.mock('../../../hooks/use-channels.js', () => ({
  useChannels: () => ({ data: { data: [{ id: 'c1', name: 'ADT Inbound' }, { id: 'c2', name: 'Lab Results' }] } }),
}));

import { CommandPalette } from '../CommandPalette.js';

function Where(): ReactNode {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const onClose = vi.fn();
const onShowShortcuts = vi.fn();

function renderPalette(permissions: readonly string[]): void {
  granted = permissions;
  render(
    <ThemeProvider theme={lightTheme}>
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <CommandPalette open onClose={onClose} onShowShortcuts={onShowShortcuts} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const input = (): HTMLElement => screen.getByRole('combobox', { name: 'Jump to' });
const type = (text: string): void => { fireEvent.change(input(), { target: { value: text } }); };
const options = (): string[] => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => { onClose.mockReset(); onShowShortcuts.mockReset(); useUiStore.setState({ themeMode: 'light' }); });
afterEach(() => { cleanup(); });

describe('CommandPalette', () => {
  it('jumps to the best match on Enter and closes', () => {
    renderPalette(['alerts:read']);
    type('aler');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/alerts');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves the selection with the arrow keys and wraps around', () => {
    renderPalette([]);
    type('adt');
    expect(options()).toEqual(['ADT InboundChannels', 'ADT Inbound messagesChannels']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/channels/c1/messages');
  });

  it('wraps from the first result to the last with ArrowUp', () => {
    renderPalette([]);
    type('adt');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('opens a channel editor when its name is clicked', () => {
    renderPalette([]);
    type('lab');
    fireEvent.click(screen.getByRole('option', { name: 'Lab Results Channels' }));
    expect(screen.getByTestId('where').textContent).toBe('/channels/c2');
  });

  it('hides pages and actions the user lacks permission for', () => {
    renderPalette([]);
    type('alert');
    expect(options()).toEqual([]);
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
  });

  it('offers create actions to users who can write', () => {
    renderPalette(['alerts:read', 'alerts:write']);
    type('new');
    expect(options()).toContain('Create alertActions');
  });

  it('switches the theme and opens the shortcut help', () => {
    renderPalette([]);
    type('dark');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(useUiStore.getState().themeMode).toBe('dark');
    cleanup();
    renderPalette([]);
    type('shortcuts');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onShowShortcuts).toHaveBeenCalled();
  });

  it('does nothing on Enter when nothing matches', () => {
    renderPalette([]);
    type('zzz');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
