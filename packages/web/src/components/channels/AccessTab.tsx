// ===========================================
// Access Tab
// ===========================================
// Who can access this channel now, and how (D-310, plan section 8): people
// whose assignments cover it, with their permissions and the role and scope
// that give them; then the people who reach every channel through code they
// can change or deploy (not recorded), or through data every channel shares.

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import type { ChannelAccessView } from '@galvanigraph/core-models';
import { api } from '../../api/client.js';
import { useChannelGroups } from '../../hooks/use-channel-groups.js';
import { accessCsv, describePath, permissionLabel } from '../../lib/channel-access.js';
import { saveFile } from '../../lib/download.js';
import { formatTimestamp } from '../../lib/format.js';
import { EmptyState } from '../common/states/EmptyState.js';
import { ErrorState } from '../common/states/ErrorState.js';
import { TableSkeleton } from '../common/states/LoadingState.js';

interface AccessTabProps {
  readonly channelId: string;
  readonly channelName: string;
}

function useChannelAccess(channelId: string): ReturnType<typeof useQuery<ChannelAccessView>> {
  return useQuery({
    queryKey: ['channel-access', channelId],
    queryFn: async () => {
      const result = await api.get<ChannelAccessView>(`/channels/${channelId}/access`);
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    },
  });
}

function OtherWays({ title, note, people }: { readonly title: string; readonly note: string; readonly people: ChannelAccessView['throughCode'] }): ReactNode {
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {people.length === 0 ? 'Nobody.' : `${String(people.length)} ${people.length === 1 ? 'person' : 'people'} ${note}: ${people.map((p) => p.username).join(', ')}`}
      </Typography>
    </Box>
  );
}

export function AccessTab({ channelId, channelName }: AccessTabProps): ReactNode {
  const { data, isLoading, error, refetch } = useChannelAccess(channelId);
  const { data: groups } = useChannelGroups();
  const groupName = (id: string): string => groups?.find((g) => g.id === id)?.name ?? id;
  const time = (iso: string): string => formatTimestamp(iso);

  if (isLoading) return <TableSkeleton rows={4} columns={3} />;
  if (error || !data) return <ErrorState title="Access could not load" error={error} onRetry={() => { void refetch(); }} />;

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1">Through GalvaniGraph (message reads are recorded)</Typography>
        <Button size="small" startIcon={<DownloadIcon />} onClick={() => { saveFile(`access-${channelName}.csv`, accessCsv(data, groupName), 'text/csv'); }}>
          Export CSV
        </Button>
      </Stack>
      {data.people.length === 0 ? (
        <EmptyState title="Nobody has access through an assignment" description="Give a role on a group this channel is in, or on every channel, from the Users page." />
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Person</TableCell><TableCell>Permissions</TableCell><TableCell>Through</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {data.people.map((p) => (
                <TableRow key={p.userId}>
                  <TableCell>{p.username}</TableCell>
                  <TableCell>{p.permissions.map(permissionLabel).join(', ')}</TableCell>
                  {/* Identical assignments are allowed, so a path is keyed by its place. */}
                  <TableCell>{p.through.map((path, i) => <Box key={i}>{describePath(path, groupName, time)}</Box>)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <OtherWays title="Through channel code (not recorded)" note="can change or deploy code in some scope, and code reaches every channel" people={data.throughCode} />
      <OtherWays title="Through shared data and logs" note="read the server log, the maps or collections every channel shares" people={data.throughSharedData} />
    </Stack>
  );
}
