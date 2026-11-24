import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import type { CollectionRecord, CollectionSummary } from '../../../hooks/use-collections.js';
import { RecordDialog } from '../RecordDialog.js';

afterEach(() => { cleanup(); });

describe('RecordDialog', () => {
  it('saves an expiry nobody changed as it was, to the second', () => {
    const onSave = vi.fn();
    const collection = { id: 'k1', name: 'orders', indexedFields: ['accession'], defaultTtlSeconds: null } as unknown as CollectionSummary;
    const record = {
      id: 'r1', fields: { accession: 'ACC1' }, payload: '{}',
      expireAt: '2026-12-01T10:20:42.000Z', createdAt: '2026-11-01T00:00:00.000Z',
    } as unknown as CollectionRecord;
    render(
      <ThemeProvider theme={darkTheme}>
        <RecordDialog collection={collection} record={record} readOnly={false} isPending={false} error={null} onSave={onSave} onClose={vi.fn()} />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByLabelText('Payload'), { target: { value: '{"status":"done"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      fields: { accession: 'ACC1' }, payload: '{"status":"done"}', expireAt: '2026-12-01T10:20:42.000Z',
    });
  });
});
