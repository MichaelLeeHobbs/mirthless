// ===========================================
// Extensions Page
// ===========================================
// Lists built-in extensions with enable/disable toggle.

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import { useExtensions, useToggleExtension } from '../hooks/use-extensions.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';

function typeColor(type: string): 'primary' | 'secondary' {
  return type === 'CONNECTOR' ? 'primary' : 'secondary';
}

export function ExtensionsPage(): ReactNode {
  const { data: extensions, isLoading, isFetching, error, refetch } = useExtensions();
  const toggleMutation = useToggleExtension();

  const handleToggle = (id: string, currentEnabled: boolean): void => {
    toggleMutation.mutate({ id, enabled: !currentEnabled });
  };

  return (
    <Box>
      <PageHeader
        title="Extensions"
        description="Built-in connectors and data types. Toggle to enable or disable each extension."
        isFetching={isFetching && !isLoading}
      />

      {error ? (
        <ErrorState
          title="Couldn't load extensions"
          error={error}
          onRetry={() => void refetch()}
          sx={{ mb: 2 }}
        />
      ) : null}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Capabilities</TableCell>
                <TableCell align="center">Enabled</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? <TableSkeleton rows={5} columns={6} /> : null}
              {extensions?.map((ext) => (
                <TableRow key={ext.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {ext.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={ext.type === 'CONNECTOR' ? 'Connector' : 'Data Type'}
                      color={typeColor(ext.type)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{ext.version}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {ext.description}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {ext.capabilities.map((cap) => (
                      <Chip key={cap} label={cap} size="small" sx={{ mr: 0.5 }} />
                    ))}
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={ext.enabled}
                      onChange={() => { handleToggle(ext.id, ext.enabled); }}
                      disabled={toggleMutation.isPending}
                      size="small"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
