// #228: with equal code (two new, empty templates) the editor kept the first template's undo history, and Ctrl+Z wrote it into the second.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import type { CodeTemplateDetail } from '../../../api/client.js';
import { fakeEditor } from '../../editors/__tests__/fake-monaco.js';

vi.mock('../../editors/monaco.js', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoModule());
vi.mock('@monaco-editor/react', async () => (await import('../../editors/__tests__/fake-monaco.js')).fakeMonacoReact);

const { TemplateEditor } = await import('../TemplateEditor.js');

afterEach(() => { cleanup(); });

const template = (id: string): CodeTemplateDetail => ({
  id, libraryId: 'lib-1', name: id, description: null, type: 'FUNCTION',
  language: 'TYPESCRIPT', code: '', contexts: [], revision: 1,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

function editorFor(t: CodeTemplateDetail): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}>
        <TemplateEditor template={t} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} saving={false} readOnly={false} canDelete />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('TemplateEditor undo', () => {
  it('does not undo the previous template\'s edits into the next one with the same code', () => {
    const { rerender } = render(editorFor(template('first')));
    const code = fakeEditor('Template code');
    act(() => { code.type('function first() {}'); });
    act(() => { code.type(''); });
    rerender(editorFor(template('second')));
    const next = fakeEditor('Template code');
    act(() => { next.undo(); });
    expect(next.getValue()).toBe('');
  });
});
