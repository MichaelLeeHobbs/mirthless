// ===========================================
// My Access Dialog
// ===========================================
// What the signed-in user may do, and where (D-310, plan section 8): each held
// permission with every channel or the groups it covers, and when the first
// temporary access ends. Read from the session the sign-in and refresh carry.

import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { ALL_CHANNELS, PERMISSION_CATALOG, type Permission } from '@galvanigraph/core-models';
import { useAuthStore } from '../../stores/auth.store.js';
import { useChannelGroups } from '../../hooks/use-channel-groups.js';
import { formatTimestamp } from '../../lib/format.js';
import { expiryState } from '../../lib/access-expiry.js';

interface MyAccessDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function labelOf(p: string): string {
  return Object.hasOwn(PERMISSION_CATALOG, p) ? PERMISSION_CATALOG[p as Permission].label : p;
}

export function MyAccessDialog({ open, onClose }: MyAccessDialogProps): ReactNode {
  // The group names load only while the dialog is open.
  return open ? <MyAccessContent onClose={onClose} /> : null;
}

function MyAccessContent({ onClose }: { readonly onClose: () => void }): ReactNode {
  const user = useAuthStore((s) => s.user);
  const { data: groups } = useChannelGroups();
  const groupName = (id: string): string => groups?.find((g) => g.id === id)?.name ?? id;
  // A server that sends no grants gave every permission on every channel.
  const rows = user?.grants ?? user?.permissions.map((permission) => ({ permission, scope: ALL_CHANNELS })) ?? [];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>My access</DialogTitle>
      <DialogContent>
        {expiryState(user?.nextExpiryAt, Date.now()) !== null ? (
          <Typography variant="body2" sx={{ mb: 1 }}>
            Some of your access is temporary: the first of it ends at {formatTimestamp(user?.nextExpiryAt)}.
          </Typography>
        ) : null}
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">You hold no permissions. Ask an administrator for access.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Permission</TableCell><TableCell>Where</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {[...rows].sort((a, b) => labelOf(a.permission).localeCompare(labelOf(b.permission))).map((g) => (
                <TableRow key={g.permission}>
                  <TableCell>{labelOf(g.permission)}</TableCell>
                  <TableCell>{g.scope === ALL_CHANNELS ? 'All channels' : g.scope.map(groupName).join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
