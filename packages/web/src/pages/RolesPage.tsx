import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import BadgeIcon from '@mui/icons-material/Badge';
import { useRoles, useDeleteRole, deleteRefusal } from '../hooks/use-roles.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { roleFlags } from '../lib/role-flags.js';
import { roleFlagLevel } from '../lib/status.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { StatusChip } from '../components/common/StatusChip.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import type { RoleSummary } from '../api/client.js';

const WIDE_ONLY = { display: { xs: 'none', md: 'table-cell' } } as const;

function holdersLabel(n: number): string {
  if (n === 0) return 'Nobody';
  return `${String(n)} ${n === 1 ? 'user' : 'users'}`;
}


function RoleRow({ role, canWrite, onDelete }: { readonly role: RoleSummary; readonly canWrite: boolean; readonly onDelete: (role: RoleSummary) => void }): ReactNode {
  const navigate = useNavigate();
  const lockedReason = role.admin ? 'The admin role is locked' : '';
  const writeReason = canWrite ? '' : 'Requires roles:write permission';
  return (
    <TableRow hover>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{role.name}</Typography>
        {role.description && <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>{role.description}</Typography>}
      </TableCell>
      <TableCell sx={WIDE_ONLY}>{role.admin ? 'Locked' : role.builtIn ? 'Built in' : 'Custom'}</TableCell>
      <TableCell sx={WIDE_ONLY}>{holdersLabel(role.holders)}</TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          {roleFlags(role.permissions, { admin: role.admin }).map((flag) => (
            <StatusChip key={flag} label={flag} level={roleFlagLevel(flag)} />
          ))}
        </Stack>
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        <Tooltip title={lockedReason || writeReason || 'Edit'}>
          <span>
            <IconButton aria-label={`Edit ${role.name}`} size="small" disabled={!canWrite || role.admin} onClick={() => { void navigate(`/roles/${role.id}`); }}>
              <EditIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={writeReason || 'Clone'}>
          <span>
            <IconButton aria-label={`Clone ${role.name}`} size="small" disabled={!canWrite} onClick={() => { void navigate(`/roles/new?from=${role.id}`); }}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={lockedReason || writeReason || (role.holders > 0 ? 'Assigned: give its holders another role first' : 'Delete')}>
          <span>
            <IconButton aria-label={`Delete ${role.name}`} size="small" disabled={!canWrite || role.admin || role.holders > 0} onClick={() => { onDelete(role); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

export function RolesPage(): ReactNode {
  const navigate = useNavigate();
  const { data: roles, isLoading, error, isFetching, refetch } = useRoles();
  const deleteRole = useDeleteRole();
  const { has } = usePermissions();
  const canWrite = has(PERMISSION.ROLES_WRITE);
  const [target, setTarget] = useState<RoleSummary | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const confirmDelete = (): void => {
    if (!target) return;
    deleteRole.mutate(target.id, {
      onSuccess: () => { setRefusal(null); },
      onError: (err) => { setRefusal(deleteRefusal(err)); },
    });
    setTarget(null);
  };

  return (
    <Box>
      <PageHeader
        title="Roles"
        description="What each job may do. Give a role to a user from the Users page."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canWrite ? '' : 'Requires roles:write permission'}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} disabled={!canWrite} onClick={() => { void navigate('/roles/new'); }}>
                New role
              </Button>
            </span>
          </Tooltip>
        }
      />

      {error && <ErrorState title="Roles couldn't load" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />}
      {refusal && <Alert severity="warning" onClose={() => { setRefusal(null); }} sx={{ mb: 2 }}>{refusal}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell sx={WIDE_ONLY}>Kind</TableCell>
              <TableCell sx={WIDE_ONLY}>Holders</TableCell>
              <TableCell>Flags</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={7} columns={5} />
            ) : roles && roles.length > 0 ? (
              roles.map((role) => <RoleRow key={role.id} role={role} canWrite={canWrite} onDelete={setTarget} />)
            ) : !error ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState dense icon={<BadgeIcon />} title="No roles yet" description="Clone a built-in role to start." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <ConfirmDialog
        open={target !== null}
        title="Delete role"
        message={`Delete the role ${target?.name ?? ''}? This cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
        isPending={deleteRole.isPending}
        onConfirm={confirmDelete}
        onCancel={() => { setTarget(null); }}
      />
    </Box>
  );
}

