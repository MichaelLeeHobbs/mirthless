// ===========================================
// AppLayout Tests
// ===========================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lightTheme } from '../../../styles/theme.js';
import { AppLayout } from '../AppLayout.js';
import { useUiStore } from '../../../stores/ui.store.js';

/** Make every media query match (or not), so useMediaQuery sees a phone or a desktop. */
function setViewport(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches, media: query, onchange: null,
    addListener: (): void => undefined, removeListener: (): void => undefined,
    addEventListener: (): void => undefined, removeEventListener: (): void => undefined,
    dispatchEvent: (): boolean => false,
  }));
}

function renderLayout(path = '/', client = new QueryClient()): void {
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="*" element={<div>Page body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AppLayout navigation drawer', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useUiStore.setState({ sidebarOpen: true });
  });

  it('starts closed on a phone so it does not cover the page', () => {
    setViewport(true);
    renderLayout();
    expect(screen.getByText('Page body')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });

  it('opens with labels from the menu button on a phone', () => {
    setViewport(true);
    renderLayout();
    fireEvent.click(screen.getByLabelText('toggle sidebar'));
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });

  it('shows the labelled sidebar on a desktop by default', () => {
    setViewport(false);
    renderLayout();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });
});

describe('AppLayout jump-to command bar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens from the header button', () => {
    setViewport(false);
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: /Jump to a page or action/ }));
    expect(screen.getByRole('combobox', { name: 'Jump to' })).toBeTruthy();
  });

  it('opens with Ctrl+K and not with a bare K', () => {
    setViewport(false);
    renderLayout();
    fireEvent.keyDown(document, { key: 'k' });
    expect(screen.queryByRole('combobox', { name: 'Jump to' })).toBeNull();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox', { name: 'Jump to' })).toBeTruthy();
  });
});


describe('AppLayout header breadcrumbs', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function trail(): HTMLElement {
    return screen.getByRole('navigation', { name: 'breadcrumb' });
  }

  it('shows the current top-level page from the sidebar label', () => {
    setViewport(false);
    renderLayout('/tags');
    expect(within(trail()).getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(within(trail()).getByText('Tags').getAttribute('aria-current')).toBe('page');
  });

  it('names the channel from the query cache and links back to it from its messages', () => {
    setViewport(false);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['channels', 'detail', 'c1'], { id: 'c1', name: 'ADT inbound' });
    renderLayout('/channels/c1/messages', client);
    expect(within(trail()).getByRole('link', { name: 'ADT inbound' }).getAttribute('href')).toBe('/channels/c1');
    expect(within(trail()).getByText('Messages')).toBeTruthy();
  });

  it('shows only the current page on a phone until the trail is expanded', () => {
    setViewport(true);
    renderLayout('/alerts/new');
    expect(within(trail()).getByText('New alert')).toBeTruthy();
    expect(within(trail()).queryByRole('link', { name: 'Alerts' })).toBeNull();
    fireEvent.click(within(trail()).getByRole('button', { name: 'Show path' }));
    expect(within(trail()).getByRole('link', { name: 'Alerts' })).toBeTruthy();
  });
});
