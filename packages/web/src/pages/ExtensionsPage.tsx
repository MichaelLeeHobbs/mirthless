// ===========================================
// Extensions Page
// ===========================================
// Read-only inventory of the built-in connectors and data types.

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
import Chip from '@mui/material/Chip';
import { useExtensions } from '../hooks/use-extensions.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { TableSkeleton } from '../components/common/states/LoadingState.js';

function typeColor(type: string): 'primary' | 'secondary' {
  return type === 'CONNECTOR' ? 'primary' : 'secondary';
}

export function ExtensionsPage(): ReactNode {
  const { data: extensions, isLoading, isFetching, error, refetch } = useExtensions();

  return (
    <Box>
      <PageHeader
        title="Extensions"
        description="Built-in connectors and data types available to every channel."
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
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? <TableSkeleton rows={5} columns={5} /> : null}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
