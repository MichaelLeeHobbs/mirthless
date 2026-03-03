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
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
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
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const reprocessMutation = useReprocessMessage();
  const bulkDeleteMutation = useBulkDeleteMessages();

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
            <Button
              size="small"
              startIcon={<ReplayIcon />}
              disabled={reprocessMutation.isPending}
              onClick={() => {
                reprocessMutation.mutate(
                  { channelId, messageId: selectedMessageId },
                  {
                    onSuccess: () => { setSnackbar('Raw content retrieved for reprocessing'); },
                    onError: (err) => { setSnackbar(`Reprocess failed: ${err.message}`); },
                  },
                );
              }}
            >
              Reprocess
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                bulkDeleteMutation.mutate(
                  { channelId, messageIds: [selectedMessageId] },
                  {
                    onSuccess: (data) => {
                      setSnackbar(`Deleted ${String(data.deletedCount)} message(s)`);
                      setSelectedMessageId(null);
                    },
                    onError: (err) => { setSnackbar(`Delete failed: ${err.message}`); },
                  },
                );
              }}
            >
              Delete
            </Button>
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

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={4000}
        onClose={() => { setSnackbar(null); }}
        message={snackbar}
      />
    </Box>
  );
}
