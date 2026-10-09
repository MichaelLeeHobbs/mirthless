// ===========================================
// Code Template read-only mode Tests
// ===========================================
// Users without code_templates:write must not see add/edit/delete/save controls:
// the server rejects those calls, so showing them only produces errors.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import type { CodeTemplateLibrary, CodeTemplateDetail } from '../../../api/client.js';

// Monaco cannot run in jsdom; record the props the editor is given instead.
const scriptEditorProps = vi.hoisted(() => ({ last: {} as Record<string, unknown> }));
vi.mock('../../editors/ScriptEditor.js', () => ({
  ScriptEditor: (props: Record<string, unknown>) => { scriptEditorProps.last = props; return null; },
}));

import { LibraryTree } from '../LibraryTree.js';
import { TemplateEditor } from '../TemplateEditor.js';

const LIBRARY: CodeTemplateLibrary = {
  id: 'lib-1', name: 'Lib', description: null, revision: 1, templateCount: 1,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const TEMPLATE: CodeTemplateDetail = {
  id: 'tpl-1', libraryId: 'lib-1', name: 'fmt', description: null, type: 'FUNCTION',
  language: 'JAVASCRIPT', code: 'function fmt() {}', contexts: [], revision: 1,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function themed(node: ReactElement): void {
  render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>);
}

function renderTree(readOnly: boolean): void {
  themed(
    <LibraryTree
      libraries={[LIBRARY]} templates={[TEMPLATE]} selectedTemplateId={null}
      onSelectTemplate={vi.fn()} onCreateTemplate={vi.fn()} onEditLibrary={vi.fn()} onDeleteLibrary={vi.fn()}
      readOnly={readOnly}
    />,
  );
}

function renderEditor(readOnly: boolean): void {
  themed(
    <TemplateEditor
      template={TEMPLATE} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} saving={false}
      readOnly={readOnly}
    />,
  );
}

afterEach(() => { cleanup(); });

describe('LibraryTree', () => {
  it('shows add, edit and delete library buttons for writers', () => {
    renderTree(false);
    expect(screen.getByLabelText('Add template')).toBeTruthy();
    expect(screen.getByTestId('DeleteIcon')).toBeTruthy();
    expect(screen.getByTestId('EditIcon')).toBeTruthy();
  });

  it('hides add, edit and delete library buttons when read-only', () => {
    renderTree(true);
    expect(screen.queryByLabelText('Add template')).toBeNull();
    expect(screen.queryByTestId('DeleteIcon')).toBeNull();
    expect(screen.queryByTestId('EditIcon')).toBeNull();
    expect(screen.getByText('Lib')).toBeTruthy();
  });
});

describe('TemplateEditor', () => {
  it('shows Delete and Save for writers', () => {
    renderEditor(false);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('hides Delete and Save when read-only', () => {
    renderEditor(true);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('disables every field and the code editor when read-only', () => {
    renderEditor(true);
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(true);
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
    expect(scriptEditorProps.last['readOnly']).toBe(true);
  });

  it('leaves fields editable for writers', () => {
    renderEditor(false);
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(false);
    expect(scriptEditorProps.last['readOnly']).toBe(false);
  });
});
