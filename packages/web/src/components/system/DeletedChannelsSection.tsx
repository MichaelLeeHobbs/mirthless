import { useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import { useDeletedChannels, usePurgeDeletedChannel, type DeletedChannel } from '../../hooks/use-deleted-channels.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { formatTimestamp, plural } from '../../lib/format.js';
import { PERMISSION } from '../../lib/permissions.js';
import { HIDE_ON_PHONE } from '../../lib/responsive.js';
import { useNotification } from '../../stores/notification.store.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { EmptyState } from '../common/states/EmptyState.js';
import { ErrorState } from '../common/states/ErrorState.js';
import { TableSkeleton } from '../common/states/LoadingState.js';

const COLUMNS = 6;

function undeliveredText({ undelivered }: DeletedChannel): string {
  return undelivered === 0 ? '' : `${String(undelivered)} not delivered`;
}

/** An earlier delete can have left rows behind that are of no message. */
function whatText({ messages }: DeletedChannel): string {
  return messages === 0 ? 'what is left of deleted messages' : plural(messages, 'message');
}

/** Names are not unique among deleted channels. */
function Identity({ channel }: { readonly channel: DeletedChannel }): ReactNode {
  return (
    <>
      {channel.name}
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontFamily: FONT_FAMILY_MONO }}>{channel.channelId.slice(0, 8)}</Typography>
    </>
  );
}

function warning(channel: DeletedChannel): string {
  return [
    `This removes ${whatText(channel)} of "${channel.name}" (${channel.channelId.slice(0, 8)}), deleted on ${formatTimestamp(channel.deletedAt)}, with their content, attachments and metadata, from this server.`,
    ...(channel.undelivered === 0 ? [] : [`${String(channel.undelivered)} of them ${channel.undelivered === 1 ? 'was' : 'were'} never delivered.`]),
    'It cannot be undone. Files on disk, messages passed on to other channels, and backups are not touched.',
  ].join(' ');
}

interface RowProps {
  readonly channel: DeletedChannel;
  readonly canPurge: boolean;
  readonly onPurge: () => void;
}

function Row({ channel, canPurge, onPurge }: RowProps): ReactNode {
  return (
    <TableRow hover>
      <TableCell><Identity channel={channel} /></TableCell>
      <TableCell sx={HIDE_ON_PHONE}>{formatTimestamp(channel.deletedAt)}</TableCell>
      <TableCell>
        {channel.messages}
        <Typography variant="caption" component="div" sx={{ color: 'status.warning' }}>{undeliveredText(channel)}</Typography>
      </TableCell>
      <TableCell sx={HIDE_ON_PHONE}>
        {formatTimestamp(channel.firstReceivedAt)}
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>to {formatTimestamp(channel.lastReceivedAt)}</Typography>
      </TableCell>
      <TableCell sx={HIDE_ON_PHONE}>{channel.prunedAfterDays === null ? 'Not pruned' : `After ${plural(channel.prunedAfterDays, 'day')}`}</TableCell>
      <TableCell align="right">
        <Tooltip title={canPurge ? '' : 'Requires settings:write permission'}>
          <span>
            <Button size="small" color="error" startIcon={<DeleteIcon />} disabled={!canPurge} onClick={onPurge} aria-label={`Delete the messages of ${channel.name}`}>
              Delete messages
            </Button>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/** Deleting a channel keeps its messages (#202). */
export function DeletedChannelsSection(): ReactNode {
  const { data, isLoading, error, refetch } = useDeletedChannels();
  const purge = usePurgeDeletedChannel();
  const { notify } = useNotification();
  const canPurge = usePermissions().has(PERMISSION.SETTINGS_WRITE);
  const [target, setTarget] = useState<DeletedChannel | null>(null);

  const handleConfirm = (reason: string): void => {
    if (target === null) return;
    const { channelId, name } = target;
    purge.mutate({ channelId, reason }, {
      onSuccess: ({ messages }) => {
        setTarget(null);
        notify(`Deleted ${plural(messages, 'message')} of ${name}`, 'success');
      },
    });
  };

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6">Deleted channels</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Deleting a channel keeps its messages. They are pruned by the settings the channel had, and can be deleted here.
      </Typography>
      {error ? <ErrorState title="Couldn't load the deleted channels" error={error} onRetry={() => void refetch()} /> : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Channel</TableCell>
                <TableCell sx={HIDE_ON_PHONE}>Deleted</TableCell>
                <TableCell>Messages</TableCell>
                <TableCell sx={HIDE_ON_PHONE}>Received</TableCell>
                <TableCell sx={HIDE_ON_PHONE}>Pruned</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? <TableSkeleton rows={2} columns={COLUMNS} /> : null}
              {data?.length === 0 ? (
                <TableRow><TableCell colSpan={COLUMNS} sx={{ border: 0 }}><EmptyState dense title="No deleted channel has messages" /></TableCell></TableRow>
              ) : null}
              {data?.map((channel) => <Row key={channel.channelId} channel={channel} canPurge={canPurge} onPurge={() => { setTarget(channel); }} />)}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {target === null ? null : (
        <ConfirmDialog
          open
          title="Delete all messages of this channel?"
          message={warning(target)}
          confirmLabel="Delete messages"
          severity="error"
          reasonLabel="Reason"
          reasonHelp="Recorded in the audit log."
          requireTyped={target.name}
          isPending={purge.isPending}
          onConfirm={(reason) => { handleConfirm(reason ?? ''); }}
          onCancel={() => { setTarget(null); }}
        />
      )}
    </Paper>
  );
}
