// ===========================================
// Message Browser Page
// ===========================================
// Search, filter, and inspect messages for a channel.
// Master-detail: paginated table top, detail panel bottom.
// WebSocket events refresh the message list in real time.

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import { useQueryClient } from '@tanstack/react-query';
import { useChannel } from '../hooks/use-channels.js';
import { useMessageSearch, type MessageSearchParams } from '../hooks/use-messages.js';
import { useSocketEvent, useSocketRoom } from '../hooks/use-socket.js';
import { MessageSearchBar } from '../components/messages/MessageSearchBar.js';
import { MessageTable } from '../components/messages/MessageTable.js';
import { MessageDetailPanel } from '../components/messages/MessageDetail.js';
import { BulkMessageActionsToolbar } from '../components/messages/BulkMessageActionsToolbar.js';
import { useReprocessMessage, useBulkDeleteMessages } from '../hooks/use-message-actions.js';
import { useMessageExport, type ExportFormat } from '../hooks/use-message-export.js';
import { PageBreadcrumbs } from '../components/common/PageBreadcrumbs.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotification } from '../stores/notification.store.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';

export function MessageBrowserPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParamsUrl] = useSearchParams();
  const channelId = id ?? '';

  const { data: channel } = useChannel(channelId.length > 0 ? channelId : null);

  // Pre-filter by status from the URL (e.g. dashboard error drill-through).
  const initialStatus = searchParamsUrl.get('status');

  // Search state
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [statuses, setStatuses] = useState<readonly string[]>(initialStatus ? [initialStatus] : []);
  const [metaDataId, setMetaDataId] = useState('');
  const [messageIdSearch, setMessageIdSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [debouncedContentSearch, setDebouncedContentSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<number>>(new Set());
  const [confirmReprocessOpen, setConfirmReprocessOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const { notify } = useNotification();
  const { has } = usePermissions();
  const canReprocess = has(PERMISSION.CHANNELS_DEPLOY);
  const canDelete = has(PERMISSION.CHANNELS_DELETE);
  const reprocessMutation = useReprocessMessage();
  const bulkDeleteMutation = useBulkDeleteMessages();
  const { exportMessages, isExporting } = useMessageExport();

  const handleReprocessConfirm = useCallback((): void => {
    if (selectedMessageId === null) return;
    setConfirmReprocessOpen(false);
    reprocessMutation.mutate(
      { channelId, messageId: selectedMessageId },
      { onSuccess: () => { notify('Message submitted for reprocessing', 'success'); } },
    );
  }, [channelId, selectedMessageId, reprocessMutation, notify]);

  const handleDeleteConfirm = useCallback((): void => {
    if (selectedMessageId === null) return;
    setConfirmDeleteOpen(false);
    bulkDeleteMutation.mutate(
      { channelId, messageIds: [selectedMessageId] },
      {
        onSuccess: (data) => {
          notify(`Deleted ${String(data.deletedCount)} message(s)`, 'success');
          setSelectedMessageId(null);
        },
      },
    );
  }, [channelId, selectedMessageId, bulkDeleteMutation, notify]);

  // Debounce content search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedContentSearch(contentSearch);
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [contentSearch]);

  // --- WebSocket: join/leave channel room (re-joins on reconnect) ---
  useSocketRoom('join:channel', 'leave:channel', channelId);

  // --- WebSocket: invalidate messages on new message events ---
  const handleNewMessage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['messages'] });
  }, [queryClient]);

  useSocketEvent('message:new', handleNewMessage);

  // Build search params
  const searchParams: MessageSearchParams = {
    channelId,
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(receivedFrom.length > 0 ? { receivedFrom: new Date(receivedFrom).toISOString() } : {}),
    ...(receivedTo.length > 0 ? { receivedTo: new Date(receivedTo).toISOString() } : {}),
    ...(metaDataId.length > 0 ? { metaDataId: Number(metaDataId) } : {}),
    ...(messageIdSearch.length > 0 ? { messageId: Number(messageIdSearch) } : {}),
    ...(debouncedContentSearch.length > 0 ? { contentSearch: debouncedContentSearch } : {}),
    limit,
    offset,
    sort: 'receivedAt',
    sortDir: 'desc',
  };

  const { data: searchResult, isLoading, error, refetch } = useMessageSearch(searchParams);

  const handlePageChange = useCallback((newOffset: number) => {
    setOffset(newOffset);
    setSelectedMessageId(null);
  }, []);

  const handleLimitChange = useCallback((newLimit: number) => {
    setLimit(newLimit);
    setOffset(0);
    setSelectedMessageId(null);
  }, []);

  const handleSelect = useCallback((messageId: number) => {
    setSelectedMessageId((prev) => (prev === messageId ? null : messageId));
  }, []);

  const items = useMemo(() => searchResult?.items ?? [], [searchResult]);

  const handleToggleChecked = useCallback((messageId: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const handleToggleCheckedAll = useCallback(() => {
    setCheckedIds((prev) => {
      const allChecked = items.length > 0 && items.every((m) => prev.has(m.messageId));
      if (allChecked) return new Set();
      return new Set(items.map((m) => m.messageId));
    });
  }, [items]);

  const clearChecked = useCallback(() => { setCheckedIds(new Set()); }, []);

  const handleExport = useCallback((format: ExportFormat) => {
    setExportAnchor(null);
    void exportMessages({
      channelId,
      channelName: channel?.name ?? 'channel',
      format,
      filters: {
        ...(statuses.length > 0 ? { status: statuses } : {}),
        ...(receivedFrom.length > 0 ? { receivedFrom: new Date(receivedFrom).toISOString() } : {}),
        ...(receivedTo.length > 0 ? { receivedTo: new Date(receivedTo).toISOString() } : {}),
        ...(metaDataId.length > 0 ? { metaDataId: Number(metaDataId) } : {}),
        ...(messageIdSearch.length > 0 ? { messageId: Number(messageIdSearch) } : {}),
        ...(debouncedContentSearch.length > 0 ? { contentSearch: debouncedContentSearch } : {}),
      },
    }).catch(() => { notify('Failed to export messages', 'error'); });
  }, [exportMessages, channelId, channel?.name, statuses, receivedFrom, receivedTo, metaDataId, messageIdSearch, debouncedContentSearch, notify]);

  // Reset pagination and clear bulk selection when filters change
  useEffect(() => {
    setOffset(0);
    setCheckedIds(new Set());
  }, [statuses, receivedFrom, receivedTo, metaDataId, messageIdSearch, debouncedContentSearch]);

  return (
    <Box>
      <PageBreadcrumbs items={[
        { label: 'Dashboard', href: '/' },
        { label: channel?.name ?? 'Channel' },
        { label: 'Messages' },
      ]} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/')}
          size="small"
        >
          Back to Dashboard
        </Button>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Messages: {channel?.name ?? 'Loading...'}
        </Typography>
        <Button
          size="small"
          startIcon={isExporting ? <CircularProgress size={16} /> : <DownloadIcon />}
          disabled={isExporting}
          aria-haspopup="menu"
          onClick={(e) => { setExportAnchor(e.currentTarget); }}
        >
          Export
        </Button>
        <Menu
          open={exportAnchor !== null}
          anchorEl={exportAnchor}
          onClose={() => { setExportAnchor(null); }}
        >
          <MenuItem onClick={() => { handleExport('csv'); }}>Export as CSV</MenuItem>
          <MenuItem onClick={() => { handleExport('json'); }}>Export as JSON</MenuItem>
        </Menu>
        {selectedMessageId !== null ? (
          <>
            <Tooltip title={canReprocess ? '' : 'Requires channels:deploy permission'}>
              <span>
                <Button
                  size="small"
                  startIcon={<ReplayIcon />}
                  disabled={reprocessMutation.isPending || !canReprocess}
                  onClick={() => { setConfirmReprocessOpen(true); }}
                >
                  Reprocess
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={canDelete ? '' : 'Requires channels:delete permission'}>
              <span>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  disabled={bulkDeleteMutation.isPending || !canDelete}
                  onClick={() => { setConfirmDeleteOpen(true); }}
                >
                  Delete
                </Button>
              </span>
            </Tooltip>
          </>
        ) : null}
      </Box>

      <MessageSearchBar
        receivedFrom={receivedFrom}
        receivedTo={receivedTo}
        statuses={statuses}
        metaDataId={metaDataId}
        messageId={messageIdSearch}
        contentSearch={contentSearch}
        connectors={(channel?.destinations ?? []).map((d, i) => ({ metaDataId: i + 1, name: d.name }))}
        onReceivedFromChange={setReceivedFrom}
        onReceivedToChange={setReceivedTo}
        onStatusesChange={setStatuses}
        onMetaDataIdChange={setMetaDataId}
        onMessageIdChange={setMessageIdSearch}
        onContentSearchChange={setContentSearch}
      />

      {error && (
        <ErrorState
          title="Couldn't search messages"
          error={error}
          onRetry={() => void refetch()}
          sx={{ mb: 2 }}
        />
      )}

      {isLoading ? (
        <LoadingBlock label="Loading messages" py={4} />
      ) : (
        <MessageTable
          items={searchResult?.items ?? []}
          total={searchResult?.total ?? 0}
          limit={searchResult?.limit ?? limit}
          offset={searchResult?.offset ?? offset}
          selectedId={selectedMessageId}
          onSelect={handleSelect}
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
          checkedIds={checkedIds}
          onToggleChecked={handleToggleChecked}
          onToggleCheckedAll={handleToggleCheckedAll}
        />
      )}

      {selectedMessageId !== null && (
        <MessageDetailPanel channelId={channelId} messageId={selectedMessageId} />
      )}

      <BulkMessageActionsToolbar
        channelId={channelId}
        selectedIds={checkedIds}
        onClear={clearChecked}
      />

      <ConfirmDialog
        open={confirmReprocessOpen}
        title="Reprocess Message"
        message={`Re-inject message #${selectedMessageId !== null ? String(selectedMessageId) : ''} into this channel's pipeline?`}
        confirmLabel="Reprocess"
        severity="warning"
        isPending={reprocessMutation.isPending}
        onConfirm={handleReprocessConfirm}
        onCancel={() => { setConfirmReprocessOpen(false); }}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Message"
        message={`Delete message #${selectedMessageId !== null ? String(selectedMessageId) : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={bulkDeleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setConfirmDeleteOpen(false); }}
      />
    </Box>
  );
}
