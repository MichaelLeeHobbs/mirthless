import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import type { CollectionRecord, CollectionSummary } from '../../../hooks/use-collections.js';
import { RecordDialog } from '../RecordDialog.js';

afterEach(() => { cleanup(); });

describe('RecordDialog', () => {
  function editRecord(expireAt = '2999-12-01T10:20:42.987Z'): ReturnType<typeof vi.fn> {
    const onSave = vi.fn();
    const collection = { id: 'k1', name: 'orders', indexedFields: ['accession'], defaultTtlSeconds: null } as unknown as CollectionSummary;
    const record = {
      id: 'r1', fields: { accession: 'ACC1' }, payload: '{}',
      expireAt, createdAt: '2026-11-01T00:00:00.000Z',
    } as unknown as CollectionRecord;
    render(
      <ThemeProvider theme={darkTheme}>
        <RecordDialog collection={collection} record={record} readOnly={false} isPending={false} error={null} onSave={onSave} onClose={vi.fn()} />
      </ThemeProvider>,
    );
    return onSave;
  }

  it('saves an expiry nobody changed as it was', () => {
    const onSave = editRecord();
    fireEvent.change(screen.getByLabelText('Payload'), { target: { value: '{"status":"done"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      fields: { accession: 'ACC1' }, payload: '{"status":"done"}', expireAt: '2999-12-01T10:20:42.987Z',
    });
  });

  it.each([['2020-01-01T00:00:00.000Z', 1], ['2999-01-01T00:00:00.000Z', 0]])('says of a record that expired that scripts no longer find it: %s', (expireAt, times) => {
    editRecord(expireAt);

    expect(screen.queryAllByText(/scripts no longer find this record/i)).toHaveLength(times);
  });

  it.each([
    ['2026-12-05T08:00:00', new Date(2026, 11, 5, 8).toISOString()],
    ['', null],
  ])('saves an expiry changed to "%s"', (value, expireAt) => {
    const onSave = editRecord();
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ expireAt }));
  });
});
