// ===========================================
// CollectionRecordsPage Tests
// ===========================================
// The records grid asks the server for the sort, search and page the user
// picked, opens a record with one click, and saves exactly what was typed.
// Users without collections:write can read a record but not change it.
// Data and permission hooks are mocked at the API boundary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../styles/theme.js';
import type { RecordListParams } from '../../hooks/use-collections.js';

const ALL = ['collections:read', 'collections:write', 'collections:delete'];
let granted: readonly string[] = ALL;
let total = 2;
let items: ReadonlyArray<Record<string, unknown>> = [];
const listCalls: RecordListParams[] = [];
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();

const COLLECTION = {
  id: 'k1', name: 'pending-orders', description: 'Orders waiting for a result',
  indexedFields: ['accession', 'facility'], defaultTtlSeconds: 2_592_000,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

function record(id: string, accession: string, payload: string): Record<string, unknown> {
  return { id, fields: { accession, facility: 'North' }, payload, expireAt: null, createdAt: '2026-10-27T12:00:00Z' };
}

vi.mock('../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => granted.includes(p) }),
}));

vi.mock('../../hooks/use-collections.js', () => ({
  useCollection: () => ({ data: COLLECTION, error: null, refetch: vi.fn() }),
  useCollectionRecords: (_id: string, params: RecordListParams) => {
    listCalls.push(params);
    return { data: { items, total }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
  },
  useCreateRecord: () => ({ mutate: createMutate, isPending: false }),
  useUpdateRecord: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteRecord: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { CollectionRecordsPage } from '../CollectionRecordsPage.js';

function renderPage(permissions: readonly string[] = ALL): void {
  granted = permissions;
  render(
    <ThemeProvider theme={darkTheme}>
      <MemoryRouter initialEntries={['/collections/k1/records']}>
        <Routes><Route path="/collections/:id/records" element={<CollectionRecordsPage />} /></Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const lastParams = (): RecordListParams => listCalls[listCalls.length - 1]!;

beforeEach(() => {
  createMutate.mockReset(); updateMutate.mockReset(); deleteMutate.mockReset();
  listCalls.length = 0;
  total = 2;
  items = [record('r1', 'A100', 'MSH|^~\\&|LAB\rPID|1'), record('r2', 'B200', '{"status":"pending"}')];
});
afterEach(() => { cleanup(); });

describe('CollectionRecordsPage', () => {
  it('shows a column per indexed field, the payload on one line, and newest first by default', () => {
    renderPage();
    for (const head of ['accession', 'facility', 'Payload', 'Created', 'Expires']) {
      expect(screen.getByRole('columnheader', { name: head })).toBeTruthy();
    }
    expect(screen.getByText('A100')).toBeTruthy();
    expect(screen.getByText('MSH|^~\\&|LAB PID|1')).toBeTruthy();
    expect(lastParams()).toMatchObject({ page: 1, pageSize: 25, sort: 'createdAt', order: 'desc' });
  });

  it('sorts on the server when a column head is clicked, flipping on a second click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'accession' }));
    expect(lastParams()).toMatchObject({ sort: 'fields.accession', order: 'asc' });
    fireEvent.click(screen.getByRole('button', { name: 'accession' }));
    expect(lastParams()).toMatchObject({ sort: 'fields.accession', order: 'desc' });
  });

  it('searches on the server once typing settles', async () => {
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search records' }), { target: { value: 'A100' } });
    await waitFor(() => { expect(lastParams().q).toBe('A100'); });
    expect(lastParams().in).toBe('');
  });

  it('says nothing matched, rather than that the collection is empty, when a search finds nothing', async () => {
    items = []; total = 0;
    renderPage();
    expect(screen.getByText('No records yet')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search records' }), { target: { value: 'zzz' } });
    await waitFor(() => { expect(screen.getByText('No matching records')).toBeTruthy(); });
  });

  it('opens a record with one click on its row and saves the edited values', () => {
    renderPage();
    fireEvent.click(screen.getByText('B200'));
    const dialog = screen.getByRole('dialog', { name: 'Edit record' });
    fireEvent.change(within(dialog).getByLabelText('accession'), { target: { value: 'B201' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(updateMutate).toHaveBeenCalledWith(
      { recordId: 'r2', input: { fields: { accession: 'B201', facility: 'North' }, payload: '{"status":"pending"}', expireAt: null } },
      expect.anything(),
    );
  });

  it('adds a record, leaving out blank fields and letting the collection default set the expiry', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Record' }));
    const dialog = screen.getByRole('dialog', { name: 'Add record' });
    expect(within(dialog).getByText('Leave blank to use the collection default (30d).')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('accession'), { target: { value: 'C300' } });
    fireEvent.change(within(dialog).getByLabelText('Payload'), { target: { value: 'hello' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(createMutate).toHaveBeenCalledWith({ fields: { accession: 'C300' }, payload: 'hello' }, expect.anything());
  });

  it('shows the server error in the dialog and keeps it open when a save fails', () => {
    createMutate.mockImplementation((_input: unknown, opts: { onError: (e: Error) => void }) => { opts.onError(new Error('store: unknown field(s) [bogus]')); });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add Record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('store: unknown field(s) [bogus]')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Add record' })).toBeTruthy();
  });

  it('names the record in the delete confirmation and deletes on confirm', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete record' })[0]!);
    expect(screen.getByText(/Delete the record with accession "A100"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).toHaveBeenCalledWith('r1', expect.anything());
  });

  it('lets a read-only user view a record but not add, save or delete', () => {
    renderPage(['collections:read']);
    expect((screen.getByRole('button', { name: 'Add Record' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Delete record' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByText('A100'));
    const dialog = screen.getByRole('dialog', { name: 'Record' });
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull();
    expect((within(dialog).getByLabelText('accession') as HTMLInputElement).readOnly).toBe(true);
  });

  it('hides the pager for one page and shows it once there is a second', () => {
    renderPage();
    expect(screen.queryByText(/rows per page/i)).toBeNull();
    cleanup();
    total = 26;
    renderPage();
    expect(screen.getByText(/rows per page/i)).toBeTruthy();
  });
});
