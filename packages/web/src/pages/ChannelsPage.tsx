// ===========================================
// Channels Page
// ===========================================
// Lists all channels with pagination, search, and CRUD actions.

import { useState, useMemo, useCallback, type ReactNode, type ChangeEvent, type MouseEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TablePagination from '@mui/material/TablePagination';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import UploadIcon from '@mui/icons-material/Upload';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import { useChannels, useDeleteChannel, useToggleChannelEnabled, useCloneChannel, type ChannelSummary } from '../hooks/use-channels.js';
import { useAllDeploymentStatuses } from '../hooks/use-deployment.js';
import { useContextMenu } from '../hooks/use-context-menu.js';
import { NewChannelDialog } from '../components/channels/NewChannelDialog.js';
import { ExportButton } from '../components/channels/ExportButton.js';
import { ImportDialog } from '../components/channels/ImportDialog.js';
import { GroupManagementDialog } from '../components/channels/GroupManagementDialog.js';
import { ChannelContextMenu } from '../components/common/ChannelContextMenu.js';
import { AssignGroupDialog } from '../components/common/AssignGroupDialog.js';
import { SendMessageDialog } from '../components/common/SendMessageDialog.js';

const CONNECTOR_TYPE_LABELS: Readonly<Record<string, string>> = {
  TCP_MLLP: 'TCP/MLLP',
  HTTP: 'HTTP',
  FILE: 'File',
  DATABASE: 'Database',
  JAVASCRIPT: 'JavaScript',
  CHANNEL: 'Channel',
  DICOM: 'DICOM',
  FHIR: 'FHIR',
};

function connectorLabel(type: string): string {
  return CONNECTOR_TYPE_LABELS[type] ?? type;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function ChannelsPage(): ReactNode {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [groupsDialogOpen, setGroupsDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelSummary | null>(null);
  const [cloneTarget, setCloneTarget] = useState<ChannelSummary | null>(null);
  const [cloneName, setCloneName] = useState('');

  // API page is 1-indexed, MUI TablePagination is 0-indexed
  const { data, isLoading, isError, error } = useChannels(page + 1, pageSize);
  const [sendMessageTarget, setSendMessageTarget] = useState<{ id: string; name: string } | null>(null);
  const deleteChannel = useDeleteChannel();
  const toggleEnabled = useToggleChannelEnabled();
  const cloneChannel = useCloneChannel();
  const deployQuery = useAllDeploymentStatuses();
  const [assignGroupTarget, setAssignGroupTarget] = useState<string | null>(null);
  const { menuState, menuTarget, handleContextMenu, handleClose: closeMenu } = useContextMenu<ChannelSummary>();

  // Build deployment state map for context menu
  const deploymentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of deployQuery.data ?? []) {
      map.set(s.channelId, s.state);
    }
    return map;
  }, [deployQuery.data]);

  const handleSendMessage = useCallback((channelId: string, channelName: string): void => {
    setSendMessageTarget({ id: channelId, name: channelName });
  }, []);

  const handleChangeGroup = useCallback((channelId: string): void => {
    setAssignGroupTarget(channelId);
  }, []);

  // Client-side search filter on the current page of results
  const filteredChannels = useMemo(() => {
    if (!data?.data) return [];
    if (!search.trim()) return data.data;
    const lower = search.toLowerCase();
    return data.data.filter(
      (ch) =>
        ch.name.toLowerCase().includes(lower) ||
        (ch.description?.toLowerCase().includes(lower) ?? false)
    );
  }, [data?.data, search]);

  const handlePageChange = (_event: MouseEvent<HTMLButtonElement> | null, newPage: number): void => {
    setPage(newPage);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setPageSize(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleToggleEnabled = (channel: ChannelSummary): void => {
    toggleEnabled.mutate({ id: channel.id, enabled: !channel.enabled });
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return;
    await deleteChannel.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleCloneOpen = (channel: ChannelSummary): void => {
    setCloneTarget(channel);
    setCloneName(`Copy of ${channel.name}`);
  };

  const handleCloneConfirm = async (): Promise<void> => {
    if (!cloneTarget || !cloneName.trim()) return;
    await cloneChannel.mutateAsync({ id: cloneTarget.id, name: cloneName.trim() });
    setCloneTarget(null);
    setCloneName('');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Channels
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<FolderSpecialIcon />}
            onClick={() => { setGroupsDialogOpen(true); }}
          >
            Groups
          </Button>
          <ExportButton />
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => { setImportDialogOpen(true); }}
          >
            Import
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setNewDialogOpen(true); }}
          >
            New Channel
          </Button>
        </Box>
      </Box>

      {/* Search */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search channels..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: 320 }}
        />
      </Paper>

      {/* Error state */}
      {isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load channels: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      ) : null}

      {/* Table */}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Enabled</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Data Types</TableCell>
              <TableCell>Rev</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton variant="text" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredChannels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {search ? 'No channels match your search.' : 'No channels yet. Create one to get started.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredChannels.map((channel) => (
                <TableRow key={channel.id} hover onContextMenu={(e) => handleContextMenu(e, channel)}>
                  <TableCell padding="checkbox">
                    <Switch
                      size="small"
                      checked={channel.enabled}
                      onChange={() => { handleToggleEnabled(channel); }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      component={RouterLink}
                      to={`/channels/${channel.id}`}
                      title={channel.name}
                      sx={{
                        fontWeight: 500,
                        color: 'primary.main',
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 300,
                      }}
                    >
                      {channel.name}
                    </Typography>
                    {channel.description ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          maxWidth: 400,
                        }}
                      >
                        {channel.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={connectorLabel(channel.sourceConnectorType)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {channel.inboundDataType} &rarr; {channel.outboundDataType}
                    </Typography>
                  </TableCell>
                  <TableCell>{channel.revision}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{formatDate(channel.updatedAt)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Clone">
                      <IconButton
                        size="small"
                        onClick={() => { handleCloneOpen(channel); }}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => { setDeleteTarget(channel); }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {data?.pagination ? (
          <TablePagination
            component="div"
            count={data.pagination.total}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={pageSize}
            onRowsPerPageChange={handlePageSizeChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        ) : null}
      </TableContainer>

      {/* New Channel Dialog */}
      <NewChannelDialog open={newDialogOpen} onClose={() => { setNewDialogOpen(false); }} />

      {/* Import Dialog */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => { setImportDialogOpen(false); }}
        onSuccess={() => { /* TanStack Query will auto-refetch */ }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteTarget !== null} onClose={() => { setDeleteTarget(null); }}>
        <DialogTitle>Delete Channel</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action can be undone by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteTarget(null); }}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteConfirm}
            disabled={deleteChannel.isPending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Channel List Context Menu */}
      <ChannelContextMenu
        menuState={menuState}
        channelId={menuTarget?.id ?? null}
        channelName={menuTarget?.name ?? null}
        state={menuTarget ? (deploymentMap.get(menuTarget.id) ?? null) : null}
        onClose={closeMenu}
        onClone={menuTarget ? (id) => {
          const ch = filteredChannels.find((c) => c.id === id);
          if (ch) handleCloneOpen(ch);
        } : undefined}
        onDelete={menuTarget ? (id) => {
          const ch = filteredChannels.find((c) => c.id === id);
          if (ch) setDeleteTarget(ch);
        } : undefined}
        onSendMessage={handleSendMessage}
        onChangeGroup={handleChangeGroup}
      />

      {/* Assign Group Dialog */}
      {assignGroupTarget ? (
        <AssignGroupDialog
          open
          onClose={() => { setAssignGroupTarget(null); }}
          channelId={assignGroupTarget}
        />
      ) : null}

      {/* Clone Channel Dialog */}
      <Dialog open={cloneTarget !== null} onClose={() => { setCloneTarget(null); }}>
        <DialogTitle>Clone Channel</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Create a copy of <strong>{cloneTarget?.name}</strong> with a new name. The cloned channel will be disabled by default.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="New Channel Name"
            value={cloneName}
            onChange={(e) => { setCloneName(e.target.value); }}
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCloneTarget(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCloneConfirm}
            disabled={cloneChannel.isPending || !cloneName.trim()}
          >
            Clone
          </Button>
        </DialogActions>
      </Dialog>

      {/* Group Management Dialog */}
      <GroupManagementDialog
        open={groupsDialogOpen}
        onClose={() => { setGroupsDialogOpen(false); }}
      />

      {/* Send Message Dialog */}
      {sendMessageTarget ? (
        <SendMessageDialog
          open
          onClose={() => { setSendMessageTarget(null); }}
          channelId={sendMessageTarget.id}
          channelName={sendMessageTarget.name}
        />
      ) : null}
    </Box>
  );
}
