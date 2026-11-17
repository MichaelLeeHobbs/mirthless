// ===========================================
// API Keys Page
// ===========================================
// Keys for machine callers (D-313, RBAC plan section 7): what each holds and
// where, who issued it, when it ends and was last used. Holders of
// api_keys:manage issue, replace, disable and revoke keys here.

import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import BlockIcon from '@mui/icons-material/Block';
import KeyIcon from '@mui/icons-material/Key';
import type { ApiKeyView } from '@galvanigraph/core-models';
import { useAuthStore } from '../stores/auth.store.js';
import { useApiKeys, useIssueApiKey, useReplaceApiKey, useRevokeApiKey, useSetApiKeyEnabled } from '../hooks/use-api-keys.js';
import { useChannelGroups } from '../hooks/use-channel-groups.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { keyScopeLabel } from '../lib/api-keys.js';
import { permissionLabel } from '../lib/channel-access.js';
import { apiKeyLevel } from '../lib/status.js';
import { formatTimestamp, humanize } from '../lib/format.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { StatusChip } from '../components/common/StatusChip.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';
import { IssueKeyDialog } from '../components/api-keys/IssueKeyDialog.js';
import { KeyTokenDialog } from '../components/api-keys/KeyTokenDialog.js';

/** Columns a phone has no room for. */
const WIDE_ONLY = { display: { xs: 'none', md: 'table-cell' } } as const;
const MANAGE_REASON = 'Requires api_keys:manage permission';

interface RowProps {
  readonly apiKey: ApiKeyView;
  readonly canManage: boolean;
  readonly groupName: (id: string) => string;
  readonly onToggle: (key: ApiKeyView) => void;
  /** A replace is under way: a second one waits, so the first token is not lost. */
  readonly replacing: boolean;
  readonly onReplace: (key: ApiKeyView) => void;
  readonly onRevoke: (key: ApiKeyView) => void;
}

function KeyRow({ apiKey: k, canManage, groupName, onToggle, replacing, onReplace, onRevoke }: RowProps): ReactNode {
  const ended = k.status === 'revoked' || k.status === 'expired';
  const status = (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <StatusChip label={humanize(k.status)} level={apiKeyLevel(k.status)} />
    </Stack>
  );
  return (
    <TableRow hover>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{k.name}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Issued by {k.issuedBy.username}</Typography>
        {/* A phone has no Status column: the chips go under the name. */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 0.5 }}>{status}</Box>
      </TableCell>
      <TableCell sx={WIDE_ONLY}>{status}</TableCell>
      <TableCell sx={WIDE_ONLY}>
        <Typography variant="body2">{k.permissions.map(permissionLabel).join(', ')}</Typography>
        <Typography variant="caption" color="text.secondary">{keyScopeLabel(k.groupIds, groupName)}</Typography>
      </TableCell>
      <TableCell sx={WIDE_ONLY}>{formatTimestamp(k.expiresAt)}</TableCell>
      <TableCell sx={WIDE_ONLY}>{formatTimestamp(k.lastUsedAt, { empty: 'Never' })}</TableCell>
      <TableCell align="right">
        {/* A column on a phone, so the row fits its width. */}
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <Tooltip title={!canManage ? MANAGE_REASON : ended ? 'It cannot work again' : k.status === 'active' ? 'Disable' : 'Enable'}>
          <span>
            <Switch checked={k.status === 'active'} disabled={!canManage || ended} onChange={() => { onToggle(k); }}
              slotProps={{ input: { 'aria-label': `${k.status === 'active' ? 'Disable' : 'Enable'} ${k.name}` } }} />
          </span>
        </Tooltip>
        <Tooltip title={!canManage ? MANAGE_REASON : ended ? 'It cannot work again' : 'Replace the secret and become its issuer'}>
          <span>
            <IconButton aria-label={`Replace ${k.name}`} size="small" disabled={!canManage || ended || replacing} onClick={() => { onReplace(k); }}>
              <AutorenewIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={!canManage ? MANAGE_REASON : k.status === 'revoked' ? 'Revoked' : 'Revoke for good'}>
          <span>
            <IconButton aria-label={`Revoke ${k.name}`} size="small" disabled={!canManage || k.status === 'revoked'} onClick={() => { onRevoke(k); }}>
              <BlockIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** Ask how a key is being replaced: a leak ends the old secret now, a planned change keeps it for 7 days. */
/**
 * Ask how a key is being replaced. Only its own issuer may keep the old secret
 * for 7 days: anyone else may be replacing it because its owner is leaving (D-322).
 */
function ReplaceDialog({ target, isOwner, onChoose, onCancel }: { readonly target: ApiKeyView | null; readonly isOwner: boolean; readonly onChoose: (mode: 'leak' | 'planned') => void; readonly onCancel: () => void }): ReactNode {
  return (
    <Dialog open={target !== null} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Replace {target?.name}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          The key gets a new secret and you become its issuer, so you must hold what it holds until it ends.
          {isOwner ? '' : ` You did not issue it, so its old secret stops at once.`}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button color="warning" onClick={() => { onChoose('leak'); }}>It leaked: end the old secret now</Button>
        {isOwner && <Button variant="contained" onClick={() => { onChoose('planned'); }}>Planned: keep the old one 7 days</Button>}
      </DialogActions>
    </Dialog>
  );
}

export function ApiKeysPage(): ReactNode {
  const { data: keys, isLoading, error, isFetching, refetch } = useApiKeys();
  const { data: groups } = useChannelGroups();
  const { has } = usePermissions();
  const canManage = has(PERMISSION.API_KEYS_MANAGE);
  const myId = useAuthStore((s) => s.user?.id);
  const issue = useIssueApiKey();
  const replace = useReplaceApiKey();
  const setEnabled = useSetApiKeyEnabled();
  const revoke = useRevokeApiKey();
  const [issueOpen, setIssueOpen] = useState(0);
  const [token, setToken] = useState<{ name: string; token: string; oldSecretUntil: string | null } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<ApiKeyView | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const groupName = (id: string): string => groups?.find((g) => g.id === id)?.name ?? id;
  const failed = (err: Error): void => { setActionError(err.message); };

  return (
    <Box>
      <PageHeader
        title="API keys"
        description="Keys for scripts and other systems. Each holds what its issuer holds, at most, and ends at a set time."
        isFetching={isFetching && !isLoading}
        actions={
          <Tooltip title={canManage ? '' : MANAGE_REASON}>
            <span>
              <Button variant="contained" startIcon={<AddIcon />} disabled={!canManage} onClick={() => { issue.reset(); setIssueOpen((n) => n + 1); }}>
                New key
              </Button>
            </span>
          </Tooltip>
        }
      />

      {error && <ErrorState title="API keys couldn't load" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />}
      {actionError && <Alert severity="error" onClose={() => { setActionError(null); }} sx={{ mb: 2 }}>{actionError}</Alert>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Key</TableCell>
              <TableCell sx={WIDE_ONLY}>Status</TableCell>
              <TableCell sx={WIDE_ONLY}>Holds</TableCell>
              <TableCell sx={WIDE_ONLY}>Ends</TableCell>
              <TableCell sx={WIDE_ONLY}>Last used</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && <TableSkeleton rows={4} columns={6} />}
            {!isLoading && keys?.map((k) => (
              <KeyRow key={k.id} apiKey={k} canManage={canManage} groupName={groupName}
                onToggle={(key) => { setEnabled.mutate({ id: key.id, enabled: key.status !== 'active' }, { onError: failed }); }}
                replacing={replace.isPending} onReplace={setReplaceTarget} onRevoke={setRevokeTarget} />
            ))}
          </TableBody>
        </Table>
        {!isLoading && !error && keys?.length === 0 && (
          <EmptyState icon={<KeyIcon />} title="No API keys" description="Issue one for a script or another system that calls the API." />
        )}
      </TableContainer>

      {issueOpen > 0 && (
        <IssueKeyDialog key={issueOpen} open saving={issue.isPending} error={issue.error?.message ?? null}
          onClose={() => { setIssueOpen(0); }}
          onIssue={(input) => {
            issue.mutate(input, {
              onSuccess: (issued) => {
                setIssueOpen(0);
                setToken({ name: issued.key.name, token: issued.token, oldSecretUntil: null });
                issue.reset();
              },
            });
          }} />
      )}
      <ReplaceDialog target={replaceTarget} isOwner={replaceTarget?.issuedBy.id === myId} onCancel={() => { setReplaceTarget(null); }}
        onChoose={(mode) => {
          if (!replaceTarget) return;
          replace.mutate({ id: replaceTarget.id, mode }, {
            onSuccess: (next) => {
              setToken({ name: next.key.name, token: next.token, oldSecretUntil: next.key.previousSecretUntil });
              replace.reset();
            },
            onError: failed,
          });
          setReplaceTarget(null);
        }} />
      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke key"
        message={`Revoke ${revokeTarget?.name ?? ''}? It stops at once and can never work again.`}
        confirmLabel="Revoke" severity="error" reasonLabel="Why" reasonHelp="Recorded in the audit log and shown with the key."
        isPending={revoke.isPending}
        onConfirm={(reason) => {
          if (revokeTarget && reason) revoke.mutate({ id: revokeTarget.id, reason }, { onError: failed });
          setRevokeTarget(null);
        }}
        onCancel={() => { setRevokeTarget(null); }}
      />
      <KeyTokenDialog shown={token} onClose={() => { setToken(null); }} />
    </Box>
  );
}
