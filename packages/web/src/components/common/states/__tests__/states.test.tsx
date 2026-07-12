// ===========================================
// Shared State Component Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import Button from '@mui/material/Button';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../../styles/theme.js';
import { EmptyState } from '../EmptyState.js';
import { ErrorState } from '../ErrorState.js';

function renderThemed(node: ReactElement): void {
  render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>);
}

describe('EmptyState', () => {
  afterEach(() => { cleanup(); });

  it('renders title, description, and action', () => {
    renderThemed(
      <EmptyState
        title="No channels yet"
        description="Create your first channel."
        action={<Button>New channel</Button>}
      />,
    );
    expect(screen.getByText('No channels yet')).toBeTruthy();
    expect(screen.getByText('Create your first channel.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New channel' })).toBeTruthy();
  });
});

describe('ErrorState', () => {
  afterEach(() => { cleanup(); });

  it('surfaces the error message from an Error', () => {
    renderThemed(<ErrorState error={new Error('boom')} />);
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('renders a friendly fallback for a non-error value', () => {
    renderThemed(<ErrorState error={{ weird: true }} />);
    expect(screen.getByText('An unexpected error occurred.')).toBeTruthy();
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    renderThemed(<ErrorState error="nope" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no handler is provided', () => {
    renderThemed(<ErrorState error="nope" />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
