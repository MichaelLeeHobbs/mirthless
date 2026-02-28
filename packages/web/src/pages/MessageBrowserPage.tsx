// ===========================================
// Message Browser Page
// ===========================================
// Search, filter, and inspect messages for a channel.
// Master-detail: paginated table top, detail panel bottom.

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useChannel } from '../hooks/use-channels.js';
import { useMessageSearch, type MessageSearchParams } from '../hooks/use-messages.js';
import { MessageSearchBar } from '../components/messages/MessageSearchBar.js';
import { MessageTable } from '../components/messages/MessageTable.js';
import { MessageDetailPanel } from '../components/messages/MessageDetail.js';

export function MessageBrowserPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  // Debounce content search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedContentSearch(contentSearch);
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [contentSearch]);

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/channels/${channelId}`)}
          size="small"
        >
          Back to Channel
        </Button>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          Messages: {channel?.name ?? 'Loading...'}
        </Typography>
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
    </Box>
  );
}
