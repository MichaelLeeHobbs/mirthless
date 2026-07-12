// ===========================================
// Bulk Message Actions Toolbar
// ===========================================
// Floating toolbar for bulk message operations (reprocess / delete). Mirrors the
// dashboard BulkActionsToolbar pattern. Actions are permission-gated and guarded
// by a ConfirmDialog. Reprocess reports a per-message success/failure summary.

import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import { useBulkReprocessMessages, useBulkDeleteMessages } from '../../hooks/use-message-actions.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { useNotification } from '../../stores/notification.store.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { PERMISSION } from '../../lib/permissions.js';

interface BulkMessageActionsToolbarProps {
  readonly channelId: string;
  readonly selectedIds: ReadonlySet<number>;
  readonly onClear: () => void;
}

export function BulkMessageActionsToolbar({ channelId, selectedIds, onClear }: BulkMessageActionsToolbarProps): ReactNode {
  const { has } = usePermissions();
  const { notify } = useNotification();
  const reprocess = useBulkReprocessMessages();
  const bulkDelete = useBulkDeleteMessages();
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canReprocess = has(PERMISSION.MESSAGES_REPROCESS);
  const canDelete = has(PERMISSION.MESSAGES_DELETE);
  const count = selectedIds.size;

  if (count === 0) return null;

  const ids = [...selectedIds];

  const handleReprocess = (): void => {
    setConfirmReprocess(false);
    reprocess.mutate(
      { channelId, messageIds: ids },
      {
        onSuccess: (data) => {
          const failed = data.requested - data.reprocessed;
          notify(
            failed > 0
              ? `Reprocessed ${String(data.reprocessed)}/${String(data.requested)}; ${String(failed)} failed`
              : `Reprocessed ${String(data.reprocessed)}/${String(data.requested)}`,
            failed > 0 ? 'warning' : 'success',
          );
          onClear();
        },
        onError: (err) => { notify(`Bulk reprocess failed: ${err.message}`, 'error'); },
      },
    );
  };

  const handleDelete = (): void => {
    setConfirmDelete(false);
    bulkDelete.mutate(
      { channelId, messageIds: ids },
      {
        onSuccess: (data) => {
          notify(`Deleted ${String(data.deletedCount)} message(s)`, 'success');
          onClear();
        },
        onError: (err) => { notify(`Bulk delete failed: ${err.message}`, 'error'); },
      },
    );
  };

  const pending = reprocess.isPending || bulkDelete.isPending;

  return (
    <>
      <Paper
        elevation={4}
        role="toolbar"
        aria-label="Bulk message actions"
        sx={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1200,
          px: 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderRadius: 2,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
          {count} selected
        </Typography>
        <Button
          size="small"
          startIcon={<ReplayIcon />}
          onClick={() => { setConfirmReprocess(true); }}
          disabled={pending || !canReprocess}
        >
          Reprocess
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => { setConfirmDelete(true); }}
          disabled={pending || !canDelete}
        >
          Delete
        </Button>
        <IconButton size="small" onClick={onClear} aria-label="Clear selection">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>

      <ConfirmDialog
        open={confirmReprocess}
        title="Reprocess Messages"
        message={`Re-inject ${String(count)} selected message(s) into this channel's pipeline?`}
        confirmLabel="Reprocess"
        severity="warning"
        isPending={reprocess.isPending}
        onConfirm={handleReprocess}
        onCancel={() => { setConfirmReprocess(false); }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete Messages"
        message={`Delete ${String(count)} selected message(s)? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={bulkDelete.isPending}
        onConfirm={handleDelete}
        onCancel={() => { setConfirmDelete(false); }}
      />
    </>
  );
}
