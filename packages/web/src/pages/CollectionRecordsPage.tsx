// ===========================================
// Collection Records Page
// ===========================================
// Grid of one collection's records: a column per indexed field, sortable
// heads, a search box, paging, and add/edit/delete in a dialog. Sorting,
// searching and paging run on the server, so they cover every record.

import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  useCollection,
  useCollectionRecords,
  useCreateRecord,
  useUpdateRecord,
  useDeleteRecord,
  type CollectionRecord,
  type CollectionSummary,
  type RecordListParams,
} from '../hooks/use-collections.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { fieldColumn, formatTtl, nextSort, payloadPreview, type RecordColumn } from '../lib/collections.js';
import { RecordDialog, type RecordDraft } from '../components/collections/RecordDialog.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotificationStore } from '../stores/notification.store.js';
import { PageBreadcrumbs } from '../components/common/PageBreadcrumbs.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { FONT_FAMILY_MONO } from '../styles/tokens.js';

const PAGE_SIZES = [25, 50, 100] as const;
const SEARCH_DELAY_MS = 300;
const MONO_CELL = { fontFamily: FONT_FAMILY_MONO, fontSize: '0.75rem' } as const;

/** The dialog's subject: a new record, or one from the grid. */
type DialogTarget = { readonly record: CollectionRecord | null } | null;

function collectionSubtitle(collection: CollectionSummary): string {
  const ttl = collection.defaultTtlSeconds === null ? 'Records never expire' : `Records expire after ${formatTtl(collection.defaultTtlSeconds)}`;
  return collection.description ? `${collection.description}. ${ttl}.` : `${ttl}.`;
}

/** The search text, settled for a moment so each keystroke isn't a request. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => { setSettled(value); }, SEARCH_DELAY_MS);
    return () => { clearTimeout(timer); };
  }, [value]);
  return settled;
}

export function CollectionRecordsPage(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const { data: collection, error: collectionError, refetch: refetchCollection } = useCollection(id);

  if (collectionError) {
    return (
      <Box>
        <PageHeader title="Records" overline={<PageBreadcrumbs items={[{ label: 'Collections', href: '/collections' }, { label: 'Records' }]} />} />
        <ErrorState title="Couldn't load this collection" error={collectionError} onRetry={() => void refetchCollection()} />
      </Box>
    );
  }
  if (!collection) {
    return (
      <Box>
        <PageHeader title="Records" overline={<PageBreadcrumbs items={[{ label: 'Collections', href: '/collections' }, { label: 'Records' }]} />} />
        <Paper><Table><TableBody><TableSkeleton rows={6} columns={4} /></TableBody></Table></Paper>
      </Box>
    );
  }
  return <RecordsGrid collection={collection} />;
}

function RecordsGrid({ collection }: { readonly collection: CollectionSummary }): ReactNode {
  const [sort, setSort] = useState<{ sort: RecordColumn; order: 'asc' | 'desc' }>({ sort: 'createdAt', order: 'desc' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [search, setSearch] = useState('');
  const [searchIn, setSearchIn] = useState<RecordColumn | ''>('');
  const q = useSettled(search);

  // A new search starts at the first page.
  useEffect(() => { setPage(0); }, [q, searchIn]);

  const params: RecordListParams = { page: page + 1, pageSize, sort: sort.sort, order: sort.order, q, in: searchIn };
  const { data, isLoading, isFetching, error, refetch } = useCollectionRecords(collection.id, params);
  const createRecord = useCreateRecord(collection.id);
  const updateRecord = useUpdateRecord(collection.id);
  const deleteRecord = useDeleteRecord(collection.id);

  const [dialog, setDialog] = useState<DialogTarget>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CollectionRecord | null>(null);

  const { has } = usePermissions();
  const canWrite = has(PERMISSION.COLLECTIONS_WRITE);
  const canDelete = has(PERMISSION.COLLECTIONS_DELETE);

  const columns: ReadonlyArray<{ readonly column: RecordColumn; readonly label: string }> = [
    ...collection.indexedFields.map((f) => ({ column: fieldColumn(f), label: f })),
    { column: 'payload', label: 'Payload' },
    { column: 'createdAt', label: 'Created' },
    { column: 'expireAt', label: 'Expires' },
  ];
  const columnCount = columns.length + 1;

  const openDialog = (record: CollectionRecord | null): void => { setSaveError(null); setDialog({ record }); };
  const closeDialog = (): void => { setDialog(null); setSaveError(null); };

  const handleSave = (draft: RecordDraft): void => {
    const options = { onSuccess: closeDialog, onError: (err: Error): void => { setSaveError(err.message); } };
    const record = dialog?.record ?? null;
    if (record === null) {
      createRecord.mutate(
        { fields: draft.fields, payload: draft.payload, ...(draft.expireAt === null ? {} : { expireAt: draft.expireAt }) },
        options,
      );
    } else {
      updateRecord.mutate({ recordId: record.id, input: draft }, options);
    }
  };

  const handleConfirmDelete = (): void => {
    if (!deleteTarget) return;
    deleteRecord.mutate(deleteTarget.id, {
      onSuccess: () => { useNotificationStore.getState().notify('Record deleted', 'success'); },
      onError: (err) => { useNotificationStore.getState().notify(`Couldn't delete the record: ${err.message}`, 'error'); },
      onSettled: () => { setDeleteTarget(null); },
    });
  };

  const searching = q.trim() !== '';
  const total = data?.total ?? 0;
  const firstField = collection.indexedFields[0] ?? '';

  return (
    <Box>
      <PageHeader
        title={collection.name}
        description={collectionSubtitle(collection)}
        overline={<PageBreadcrumbs items={[{ label: 'Collections', href: '/collections' }, { label: collection.name }]} />}
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires collections:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => { openDialog(null); }} disabled={!canWrite}>
                Add Record
              </Button>
            </span>
          </Tooltip>
        }
      />

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search records"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
            htmlInput: { 'aria-label': 'Search records' },
          }}
          sx={{ flex: '1 1 260px', maxWidth: 420 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="records-search-in" shrink>Search in</InputLabel>
          <Select
            labelId="records-search-in"
            label="Search in"
            displayEmpty
            notched
            value={searchIn}
            onChange={(e) => { setSearchIn(e.target.value as RecordColumn | ''); }}
          >
            <MenuItem value="">All columns</MenuItem>
            {collection.indexedFields.map((f) => <MenuItem key={f} value={fieldColumn(f)}>{f}</MenuItem>)}
            <MenuItem value="payload">Payload</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: { sm: 'auto' } }}>
          {data ? `${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}${searching ? ' found' : ''}` : ''}
        </Typography>
      </Box>

      {error ? (
        <ErrorState title="Couldn't load records" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      ) : null}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map(({ column, label }) => (
                <TableCell key={column} sortDirection={sort.sort === column ? sort.order : false}>
                  <TableSortLabel
                    active={sort.sort === column}
                    direction={sort.sort === column ? sort.order : 'asc'}
                    onClick={() => { setSort(nextSort(sort, column)); setPage(0); }}
                  >
                    {label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell align="right" aria-label="Row actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={columnCount} />
            ) : data && data.items.length > 0 ? (
              data.items.map((record) => (
                <TableRow key={record.id} hover onClick={() => { openDialog(record); }} sx={{ cursor: 'pointer' }}>
                  {collection.indexedFields.map((f) => (
                    <TableCell key={f} sx={{ ...MONO_CELL, whiteSpace: 'nowrap' }}>{record.fields[f] ?? ''}</TableCell>
                  ))}
                  <TableCell sx={{ ...MONO_CELL, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {payloadPreview(record.payload)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(record.createdAt).toLocaleString()}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{record.expireAt ? new Date(record.expireAt).toLocaleString() : 'Never'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }} onClick={(e) => { e.stopPropagation(); }}>
                    <Tooltip title={canWrite ? 'Edit' : 'View'}>
                      <IconButton aria-label={canWrite ? 'Edit record' : 'View record'} size="small" onClick={() => { openDialog(record); }}>
                        {canWrite ? <EditIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={canDelete ? 'Delete' : 'Requires collections:delete permission'}>
                      <span>
                        <IconButton aria-label="Delete record" size="small" onClick={() => { setDeleteTarget(record); }} disabled={!canDelete}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  {searching ? (
                    <EmptyState dense icon={<SearchIcon />} title="No matching records" description={`Nothing matches "${q.trim()}". Try other text or search all columns.`} />
                  ) : (
                    <EmptyState
                      dense
                      icon={<StorageIcon />}
                      title="No records yet"
                      description="Channel scripts add records with getCollection(). You can also add one here."
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {total > PAGE_SIZES[0] ? (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_e, next) => { setPage(next); }}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[...PAGE_SIZES]}
          />
        ) : null}
      </TableContainer>

      {dialog ? (
        <RecordDialog
          key={dialog.record?.id ?? 'new'}
          collection={collection}
          record={dialog.record}
          readOnly={!canWrite}
          isPending={createRecord.isPending || updateRecord.isPending}
          error={saveError}
          onSave={handleSave}
          onClose={closeDialog}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete record"
        message={`Delete the record${firstField && deleteTarget?.fields[firstField] ? ` with ${firstField} "${deleteTarget.fields[firstField]}"` : ''}? This can't be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteRecord.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => { setDeleteTarget(null); }}
      />
    </Box>
  );
}
