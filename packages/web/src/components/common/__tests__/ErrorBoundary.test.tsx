// ===========================================
// ErrorBoundary Tests
// ===========================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

function Thrower({ error }: { readonly error: unknown }): ReactElement {
  throw error;
}

function renderBoundary(error: unknown): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <ErrorBoundary>
        <Thrower error={error} />
      </ErrorBoundary>
    </ThemeProvider>,
  );
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React and the boundary both log the caught error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the error's message", () => {
    renderBoundary(new Error('Render failed'));
    expect(screen.getByText('Render failed')).toBeTruthy();
  });

  it('shows the fallback for an error with an empty message', () => {
    renderBoundary(new Error(''));
    expect(screen.getByText('An unexpected error occurred')).toBeTruthy();
  });

  it('shows the fallback for a thrown non-Error value', () => {
    renderBoundary({ code: 42 });
    expect(screen.getByText('An unexpected error occurred')).toBeTruthy();
  });
});
