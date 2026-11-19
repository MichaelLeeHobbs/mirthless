// The protected audit log (D-312). Render only for holders of audit:read.

import { Fragment, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ShieldIcon from '@mui/icons-material/Shield';
import { AUDIT_ACTION } from '@galvanigraph/core-models';
import { useAuditRecords } from '../../hooks/use-audit.js';
import { StatusChip } from '../common/StatusChip.js';
import { EmptyState } from '../common/states/EmptyState.js';
import { ErrorState } from '../common/states/ErrorState.js';
import { TableSkeleton } from '../common/states/LoadingState.js';
import { eventOutcomeLevel } from '../../lib/status.js';
import { formatTimestamp, humanize } from '../../lib/format.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import type { AuditEntry } from '../../api/client.js';

const COLUMNS = 6;

function AttributesRow({ entry, open }: { readonly entry: AuditEntry; readonly open: boolean }): ReactNode {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <Box sx={{ p: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Details</Typography>
            <Box component="pre" sx={{ m: 0, mt: 0.5, fontFamily: FONT_FAMILY_MONO, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(entry.attributes ?? {}, null, 2)}
            </Box>
          </Box>
        </Collapse>
      </TableCell>
    </TableRow>
  );
}

function EntryRow({ entry, open, onToggle }: { readonly entry: AuditEntry; readonly open: boolean; readonly onToggle: () => void }): ReactNode {
  return (
    <Fragment>
      <TableRow hover sx={{ '& > *': { borderBottom: open ? 'unset' : undefined } }}>
        <TableCell padding="checkbox">
          <IconButton aria-label={open ? 'Collapse record details' : 'Expand record details'} size="small" onClick={onToggle}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{formatTimestamp(entry.occurredAt)}</TableCell>
        <TableCell sx={{ fontSize: '0.8rem' }}>{humanize(entry.action)}</TableCell>
        <TableCell><StatusChip label={humanize(entry.outcome)} level={eventOutcomeLevel(entry.outcome)} /></TableCell>
        <TableCell sx={{ fontFamily: FONT_FAMILY_MONO, fontSize: '0.7rem' }}>{entry.userId ? `${entry.userId.slice(0, 8)}...` : '-'}</TableCell>
        <TableCell sx={{ fontSize: '0.8rem' }}>{entry.ipAddress ?? '-'}</TableCell>
      </TableRow>
      <AttributesRow entry={entry} open={open} />
    </Fragment>
  );
}

export function AccessRecords(): ReactNode {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading, error, refetch } = useAuditRecords({
    page: page + 1, pageSize,
    ...(action !== '' ? { action } : {}),
    ...(outcome !== '' ? { outcome } : {}),
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="audit-filter-action-label">Action</InputLabel>
          <Select labelId="audit-filter-action-label" value={action} label="Action" onChange={(e) => { setAction(e.target.value); setPage(0); }}>
            <MenuItem value="">All</MenuItem>
            {Object.values(AUDIT_ACTION).map((a) => <MenuItem key={a} value={a}>{humanize(a)}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="audit-filter-outcome-label">Outcome</InputLabel>
          <Select labelId="audit-filter-outcome-label" value={outcome} label="Outcome" onChange={(e) => { setOutcome(e.target.value); setPage(0); }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="SUCCESS">{humanize('SUCCESS')}</MenuItem>
            <MenuItem value="FAILURE">{humanize('FAILURE')}</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error ? <ErrorState title="Couldn't load access records" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} /> : null}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Date/Time</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>User ID</TableCell>
              <TableCell>IP Address</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={6} columns={COLUMNS} />
            ) : data && data.data.length > 0 ? (
              data.data.map((entry) => (
                <EntryRow key={`${String(entry.id)}-${entry.occurredAt}`} entry={entry} open={expanded === entry.id}
                  onToggle={() => { setExpanded(expanded === entry.id ? null : entry.id); }} />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={COLUMNS}>
                  <EmptyState dense icon={<ShieldIcon />} title="No access records"
                    description="Sign-ins, refused requests and purges appear here. Nobody can change or delete them." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {data && data.pagination.total > 10 ? (
          <TablePagination component="div" count={data.pagination.total} page={page}
            onPageChange={(_e, p) => { setPage(p); }} rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} />
        ) : null}
      </TableContainer>
    </Box>
  );
}
