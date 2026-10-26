// ===========================================
// AppLayout Tests
// ===========================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

function renderLayout(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<div>Page body</div>} />
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
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('opens with labels from the menu button on a phone', () => {
    setViewport(true);
    renderLayout();
    fireEvent.click(screen.getByLabelText('toggle sidebar'));
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('shows the labelled sidebar on a desktop by default', () => {
    setViewport(false);
    renderLayout();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });
});
