// ===========================================
// GlobalScriptsPage Tests
// ===========================================
// Behavior tests: renders the 4 script-type tabs, switches the edited script on
// tab selection, and enables Save once the editor content is dirtied.
// The Monaco-backed ScriptEditor is replaced with a plain textarea.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../styles/theme.js';

// ----- Mocks -----

const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
const notifyMock = vi.fn();
const refetchMock = vi.fn();

const scriptsData = {
  deploy: 'deploy-src',
  undeploy: 'undeploy-src',
  preprocessor: 'preprocessor-src',
  postprocessor: 'postprocessor-src',
};

vi.mock('react-router-dom', () => ({
  useBlocker: () => ({ state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }),
}));

vi.mock('../../hooks/use-beforeunload.js', () => ({
  useBeforeUnload: () => undefined,
}));

vi.mock('../../hooks/use-global-scripts.js', () => ({
  useGlobalScripts: () => ({
    data: scriptsData,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: refetchMock,
  }),
  useUpdateGlobalScripts: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

vi.mock('../../stores/notification.store.js', () => ({
  useNotification: () => ({ notify: notifyMock }),
}));

// Replace Monaco editor with a controlled textarea so tab/edit behavior is observable.
vi.mock('../../components/editors/ScriptEditor.js', () => ({
  ScriptEditor: ({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) => (
    <textarea
      data-testid="script-editor"
      value={value}
      onChange={(e) => { onChange(e.target.value); }}
    />
  ),
}));

import { GlobalScriptsPage } from '../GlobalScriptsPage.js';

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node: ReactElement = (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <GlobalScriptsPage />
      </ThemeProvider>
    </QueryClientProvider>
  );
  render(node);
}

beforeEach(() => {
  updateMutateAsync.mockClear();
  notifyMock.mockClear();
  refetchMock.mockClear();
});
afterEach(() => { cleanup(); });

describe('GlobalScriptsPage', () => {
  it('renders the title and all four script-type tabs', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Global Scripts' })).toBeTruthy();
    for (const label of ['Deploy', 'Undeploy', 'Preprocessor', 'Postprocessor']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('shows the deploy script in the editor initially', () => {
    renderPage();
    const editor = screen.getByTestId('script-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('deploy-src');
  });

  it('switches the edited script when a different tab is selected', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Undeploy' }));
    const editor = screen.getByTestId('script-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('undeploy-src');

    fireEvent.click(screen.getByRole('tab', { name: 'Postprocessor' }));
    expect((screen.getByTestId('script-editor') as HTMLTextAreaElement).value).toBe('postprocessor-src');
  });

  it('keeps Save disabled until the script is edited, then saves', async () => {
    renderPage();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);

    const editor = screen.getByTestId('script-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'deploy-src // edited' } });
    expect(editor.value).toBe('deploy-src // edited');
    expect(save).toHaveProperty('disabled', false);

    await act(async () => { fireEvent.click(save); });
    // mutateAsync is called with the full scripts object including the edit.
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({ deploy: 'deploy-src // edited' });
  });
});
