// ===========================================
// Connector Stats Table
// ===========================================
// Per-connector statistics breakdown table.

import type { ReactNode } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ConnectorStats } from '../../hooks/use-statistics.js';

interface ConnectorStatsTableProps {
  readonly connectors: readonly ConnectorStats[];
}

function connectorLabel(metaDataId: number | null): string {
  if (metaDataId === null || metaDataId === 0) return 'Source';
  return `Destination ${String(metaDataId)}`;
}

export function ConnectorStatsTable({ connectors }: ConnectorStatsTableProps): ReactNode {
  if (connectors.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No connector statistics available.
      </Typography>
    );
  }

  return (
    <Paper>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Connector</TableCell>
              <TableCell align="right">Received</TableCell>
              <TableCell align="right">Filtered</TableCell>
              <TableCell align="right">Sent</TableCell>
              <TableCell align="right">Errored</TableCell>
              <TableCell align="right">Received (Lifetime)</TableCell>
              <TableCell align="right">Filtered (Lifetime)</TableCell>
              <TableCell align="right">Sent (Lifetime)</TableCell>
              <TableCell align="right">Errored (Lifetime)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {connectors.map((c) => (
              <TableRow key={c.metaDataId ?? 'source'} hover>
                <TableCell>{connectorLabel(c.metaDataId)}</TableCell>
                <TableCell align="right">{c.received.toLocaleString()}</TableCell>
                <TableCell align="right">{c.filtered.toLocaleString()}</TableCell>
                <TableCell align="right">{c.sent.toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: c.errored > 0 ? 'error.main' : undefined }}>
                  {c.errored.toLocaleString()}
                </TableCell>
                <TableCell align="right">{c.receivedLifetime.toLocaleString()}</TableCell>
                <TableCell align="right">{c.filteredLifetime.toLocaleString()}</TableCell>
                <TableCell align="right">{c.sentLifetime.toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: c.erroredLifetime > 0 ? 'error.main' : undefined }}>
                  {c.erroredLifetime.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
