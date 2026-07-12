// ===========================================
// Message Browser Page
// ===========================================
// Search, filter, and inspect messages for a channel.
// Master-detail: paginated table top, detail panel bottom.
// WebSocket events refresh the message list in real time.

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { useChannel } from '../hooks/use-channels.js';
import { useMessageSearch, type MessageSearchParams } from '../hooks/use-messages.js';
import { useSocketEvent, useSocketRoom } from '../hooks/use-socket.js';
import { MessageSearchBar } from '../components/messages/MessageSearchBar.js';
import { MessageTable } from '../components/messages/MessageTable.js';
import { MessageDetailPanel } from '../components/messages/MessageDetail.js';
import { useReprocessMessage, useBulkDeleteMessages } from '../hooks/use-message-actions.js';
import { PageBreadcrumbs } from '../components/common/PageBreadcrumbs.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotification } from '../stores/notification.store.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';

export function MessageBrowserPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channelId = id ?? '';

  const { data: channel } = useChannel(channelId.length > 0 ? channelId : null);

  // Search state
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [statuses, setStatuses] = useState<readonly string[]>([]);
  const [metaDataId, setMetaDataId] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [debouncedContentSearch, setDebouncedContentSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [confirmReprocessOpen, setConfirmReprocessOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { notify } = useNotification();
  const { has } = usePermissions();
  const canReprocess = has(PERMISSION.CHANNELS_DEPLOY);
  const canDelete = has(PERMISSION.CHANNELS_DELETE);
  const reprocessMutation = useReprocessMessage();
  const bulkDeleteMutation = useBulkDeleteMessages();

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
    ...(debouncedContentSearch.length > 0 ? { contentSearch: debouncedContentSearch } : {}),
    limit,
    offset,
    sort: 'receivedAt',
    sortDir: 'desc',
  };

  const { data: searchResult, isLoading, error } = useMessageSearch(searchParams);

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

  // Reset pagination when filters change
  useEffect(() => {
    setOffset(0);
  }, [statuses, receivedFrom, receivedTo, metaDataId, debouncedContentSearch]);

  return (
    <Box>
      <PageBreadcrumbs items={[
        { label: 'Channels', href: '/channels' },
        { label: channel?.name ?? 'Channel', href: `/channels/${channelId}` },
        { label: 'Messages' },
      ]} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/channels/${channelId}`)}
          size="small"
        >
          Back to Channel
        </Button>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          Messages: {channel?.name ?? 'Loading...'}
        </Typography>
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
        contentSearch={contentSearch}
        onReceivedFromChange={setReceivedFrom}
        onReceivedToChange={setReceivedTo}
        onStatusesChange={setStatuses}
        onMetaDataIdChange={setMetaDataId}
        onContentSearchChange={setContentSearch}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to search messages: {error.message}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
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
        />
      )}

      {selectedMessageId !== null && (
        <MessageDetailPanel channelId={channelId} messageId={selectedMessageId} />
      )}

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
