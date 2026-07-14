// ===========================================
// AlertEditorPage Tests
// ===========================================
// Behavior tests for the alert editor: section rendering + field/state interaction.
// Data hooks and react-router are mocked; react-hook-form runs for real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { darkTheme } from '../../styles/theme.js';

// ----- Mocks -----

const navigateMock = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({}), // no id -> create mode
    useNavigate: () => navigateMock,
    useBlocker: () => ({ state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }),
  };
});

vi.mock('../../hooks/use-beforeunload.js', () => ({
  useBeforeUnload: () => undefined,
}));

vi.mock('../../hooks/use-alerts.js', () => ({
  useAlert: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  useCreateAlert: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateAlert: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

// Both ChannelsSection and ActionsSection pull channels from this hook.
vi.mock('../../hooks/use-channels.js', () => ({
  useChannels: () => ({ data: { data: [] }, isLoading: false }),
}));

import { AlertEditorPage } from '../AlertEditorPage.js';

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node: ReactElement = (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <MemoryRouter>
          <AlertEditorPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
  render(node);
}

beforeEach(() => {
  navigateMock.mockReset();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});
afterEach(() => { cleanup(); });

describe('AlertEditorPage (create mode)', () => {
  it('renders the create header and all editor sections', () => {
    renderPage();

    // Header for create mode
    expect(screen.getByRole('heading', { name: 'New Alert' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();

    // Each section heading is present
    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Trigger' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Channels' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Actions' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Notification Templates' })).toBeTruthy();
  });

  it('updates the name field on typing', () => {
    renderPage();
    const name = screen.getByLabelText(/Name/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Nightly errors' } });
    expect(name.value).toBe('Nightly errors');
  });

  it('updates trigger regex state on typing', () => {
    renderPage();
    const regex = screen.getByLabelText(/Regex Filter/) as HTMLInputElement;
    fireEvent.change(regex, { target: { value: 'ERR.*' } });
    // The parent owns trigger state; a re-render reflecting the value proves
    // the onChange -> setTrigger -> controlled-value round trip works.
    expect(regex.value).toBe('ERR.*');
  });

  it('toggles an error-event-type checkbox in the trigger section', () => {
    renderPage();
    // Default trigger has errorTypes: ['ANY'] -> ANY checked, others not.
    const any = screen.getByRole('checkbox', { name: 'ANY' }) as HTMLInputElement;
    const src = screen.getByRole('checkbox', { name: 'SOURCE CONNECTOR' }) as HTMLInputElement;
    expect(any.checked).toBe(true);
    expect(src.checked).toBe(false);

    fireEvent.click(src);
    expect(src.checked).toBe(true);
  });

  it('adds an action row when Add Action is clicked', () => {
    renderPage();
    // No actions initially.
    expect(screen.getByText(/No actions configured/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add Action/ }));

    // A new action card appears with a Type selector defaulting to Email.
    expect(screen.getByText('Action 1')).toBeTruthy();
    const typeField = screen.getByLabelText('Type');
    expect(within(typeField.closest('.MuiFormControl-root') as HTMLElement).getByText('Email')).toBeTruthy();
  });
});
