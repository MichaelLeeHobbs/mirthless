// ===========================================
// Traffic Page (Global Traffic & Triage)
// ===========================================
// Engine-wide message ops: a "Needs Attention" feed of errored messages across all
// channels with one-click reprocess, plus cross-channel search. Per-channel message
// browsing still lives behind each channel (channel context menu -> Messages).

import { useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Badge from '@mui/material/Badge';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { MESSAGE_STATUS } from '@mirthless/core-models';
import { useCrossChannelSearch, type CrossChannelFilters } from '../hooks/use-cross-channel-search.js';
import { useReprocessMessage } from '../hooks/use-message-actions.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TrafficSummary } from '../components/traffic/TrafficSummary.js';
import { MessageResultsTable } from '../components/traffic/MessageResultsTable.js';
import { useNotification } from '../stores/notification.store.js';

const STATUS_OPTIONS = Object.values(MESSAGE_STATUS);

export function TrafficPage(): ReactNode {
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const [tab, setTab] = useState(0);

  // --- Triage feed (errors across all channels) ---
  const [triageLimit, setTriageLimit] = useState(25);
  const [triageOffset, setTriageOffset] = useState(0);
  const triage = useCrossChannelSearch({ status: 'ERROR', limit: triageLimit, offset: triageOffset });

  // --- Search ---
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchLimit, setSearchLimit] = useState(25);
  const [searchOffset, setSearchOffset] = useState(0);
  const searchFilters: CrossChannelFilters = {
    limit: searchLimit,
    offset: searchOffset,
    ...(status ? { status } : {}),
    ...(dateFrom ? { dateFrom: new Date(dateFrom).toISOString() } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo).toISOString() } : {}),
  };
  const search = useCrossChannelSearch(searchFilters);

  // --- Reprocess ---
  const reprocess = useReprocessMessage();
  const [reprocessingKey, setReprocessingKey] = useState<string | null>(null);
  const handleReprocess = useCallback(async (channelId: string, messageId: number): Promise<void> => {
    const key = `${channelId}-${String(messageId)}`;
    setReprocessingKey(key);
    try {
      await reprocess.mutateAsync({ channelId, messageId });
      notify(`Message ${String(messageId)} reprocessed`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['cross-channel-search'] });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Reprocess failed', 'error');
    } finally {
      setReprocessingKey(null);
    }
  }, [reprocess, notify, queryClient]);

  const errorCount = triage.data?.total ?? 0;

  return (
    <Box>
      <PageHeader
        title="Traffic"
        description="Engine-wide message flow and error triage across every channel."
        isFetching={(triage.isFetching || search.isFetching) && !(triage.isLoading || search.isLoading)}
      />

      <TrafficSummary />

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_e, v: number) => { setTab(v); }} sx={{ px: 1 }}>
          <Tab label={<Badge color="error" badgeContent={errorCount} max={999} sx={{ '& .MuiBadge-badge': { right: -14, top: 4 } }}>Needs Attention</Badge>} />
          <Tab label="Search" />
        </Tabs>
      </Paper>

      {tab === 0 ? (
        <>
          {triage.error ? (
            <ErrorState title="Couldn't load the triage feed" error={triage.error} onRetry={() => void triage.refetch()} sx={{ mb: 2 }} />
          ) : null}
          <MessageResultsTable
            items={triage.data?.items ?? []}
            total={triage.data?.total ?? 0}
            limit={triageLimit}
            offset={triageOffset}
            isLoading={triage.isLoading}
            emptyTitle="Nothing needs attention"
            emptyDescription="No errored messages across any channel. Nice."
            onPageChange={(page) => { setTriageOffset(page * triageLimit); }}
            onRowsPerPageChange={(rows) => { setTriageLimit(rows); setTriageOffset(0); }}
            onReprocess={(channelId, messageId) => { void handleReprocess(channelId, messageId); }}
            reprocessingKey={reprocessingKey}
          />
        </>
      ) : (
        <>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl sx={{ minWidth: 160 }}>
                <InputLabel>Status</InputLabel>
                <Select value={status} label="Status" size="small" onChange={(e) => { setStatus(e.target.value); setSearchOffset(0); }}>
                  <MenuItem value="">All</MenuItem>
                  {STATUS_OPTIONS.map((s) => (<MenuItem key={s} value={s}>{s}</MenuItem>))}
                </Select>
              </FormControl>
              <TextField label="From" type="datetime-local" value={dateFrom} size="small" slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => { setDateFrom(e.target.value); setSearchOffset(0); }} />
              <TextField label="To" type="datetime-local" value={dateTo} size="small" slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => { setDateTo(e.target.value); setSearchOffset(0); }} />
            </Box>
          </Paper>

          {search.error ? (
            <ErrorState title="Couldn't search messages" error={search.error} onRetry={() => void search.refetch()} sx={{ mb: 2 }} />
          ) : null}
          <MessageResultsTable
            items={search.data?.items ?? []}
            total={search.data?.total ?? 0}
            limit={searchLimit}
            offset={searchOffset}
            isLoading={search.isLoading}
            emptyTitle="No messages found"
            emptyDescription="Try widening the date range or clearing the status filter."
            onPageChange={(page) => { setSearchOffset(page * searchLimit); }}
            onRowsPerPageChange={(rows) => { setSearchLimit(rows); setSearchOffset(0); }}
          />
        </>
      )}
    </Box>
  );
}
