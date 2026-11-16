// #228: the Global Scripts page with the script editor itself, on a fake
// Monaco (fake-monaco.tsx). Switching tabs puts the other script into the one
// editor, and that is not an edit.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../styles/theme.js';
import { fakeEditor } from '../../components/editors/__tests__/fake-monaco.js';

vi.mock('../../components/editors/monaco.js', async () => (await import('../../components/editors/__tests__/fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('../../components/editors/__tests__/fake-monaco.js')).fakeMonacoReact);

// Whether the page last asked to block navigation (the "Unsaved Changes" prompt).
const blocker = vi.hoisted(() => ({ armed: false }));
vi.mock('react-router', () => ({
  useBlocker: (when: boolean) => { blocker.armed = when; return { state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }; },
}));
vi.mock('../../hooks/use-beforeunload.js', () => ({ useBeforeUnload: () => undefined }));
vi.mock('../../stores/notification.store.js', () => ({ useNotification: () => ({ notify: vi.fn() }) }));
// One object for every render, as TanStack Query returns: the page reloads its form when data changes.
const scriptsData = { deploy: 'deploy-src', undeploy: 'undeploy-src', preprocessor: '', postprocessor: '' };
vi.mock('../../hooks/use-global-scripts.js', () => ({
  useGlobalScripts: () => ({
    data: scriptsData,
    isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  }),
  useUpdateGlobalScripts: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { GlobalScriptsPage } = await import('../GlobalScriptsPage.js');

afterEach(() => { cleanup(); });

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}><GlobalScriptsPage /></ThemeProvider>
    </QueryClientProvider>,
  );
}

const save = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' });

describe('GlobalScriptsPage editor', () => {
  it('stays clean when switching tabs: no Save, no unsaved-changes prompt', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Undeploy' }));
    expect(fakeEditor('Global undeploy script').getValue()).toBe('undeploy-src');
    fireEvent.click(screen.getByRole('tab', { name: 'Postprocessor' }));
    expect(save().disabled).toBe(true);
    expect(blocker.armed).toBe(false);
  });

  it('turns Save on when the user edits the script', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Undeploy' }));
    act(() => { fakeEditor('Global undeploy script').type('undeploy-src // edited'); });
    expect(save().disabled).toBe(false);
    expect(blocker.armed).toBe(true);
  });
});
