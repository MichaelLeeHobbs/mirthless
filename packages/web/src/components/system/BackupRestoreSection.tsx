// ===========================================
// Backup/Restore Section
// ===========================================
// Download backup and upload restore with collision mode selector.

import { useState, useRef, type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { SelectChangeEvent } from '@mui/material/Select';
import type { ServerRestoreResult } from '@mirthless/core-models';
import { useBackup, useRestore } from '../../hooks/use-backup.js';

export function BackupRestoreSection(): ReactNode {
  const backupMutation = useBackup();
  const restoreMutation = useRestore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [collisionMode, setCollisionMode] = useState<'SKIP' | 'OVERWRITE'>('SKIP');
  const [backupData, setBackupData] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [restoreResult, setRestoreResult] = useState<ServerRestoreResult | null>(null);

  const handleDownload = (): void => {
    backupMutation.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `mirthless-backup-${timestamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event): void => {
      try {
        const parsed: unknown = JSON.parse(event.target?.result as string);
        setBackupData(parsed);
        setRestoreDialogOpen(true);
      } catch {
        setBackupData(null);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleRestore = (): void => {
    if (!backupData) return;
    restoreMutation.mutate(
      { backup: backupData, collisionMode },
      {
        onSuccess: (result) => {
          setRestoreResult(result);
          setRestoreDialogOpen(false);
        },
        onError: () => {
          setRestoreDialogOpen(false);
        },
      },
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Backup & Restore</Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Button
          variant="contained"
          onClick={handleDownload}
          disabled={backupMutation.isPending}
        >
          {backupMutation.isPending ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
          Download Backup
        </Button>

        <Button
          variant="outlined"
          onClick={() => fileInputRef.current?.click()}
          disabled={restoreMutation.isPending}
        >
          {restoreMutation.isPending ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
          Restore from File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </Box>

      {backupMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Backup failed: {backupMutation.error.message}
        </Alert>
      )}

      {restoreMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Restore failed: {restoreMutation.error.message}
        </Alert>
      )}

      {restoreResult && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            Restore complete: {restoreResult.totalCreated} created, {restoreResult.totalUpdated} updated,
            {' '}{restoreResult.totalSkipped} skipped, {restoreResult.totalErrors} errors
          </Alert>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Section</TableCell>
                <TableCell align="right">Created</TableCell>
                <TableCell align="right">Updated</TableCell>
                <TableCell align="right">Skipped</TableCell>
                <TableCell align="right">Errors</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {restoreResult.sections.map((s) => (
                <TableRow key={s.section}>
                  <TableCell>{s.section}</TableCell>
                  <TableCell align="right">{s.created}</TableCell>
                  <TableCell align="right">{s.updated}</TableCell>
                  <TableCell align="right">{s.skipped}</TableCell>
                  <TableCell align="right">{s.errors.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Restore Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onClose={() => setRestoreDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Restore from Backup</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            File: {fileName}
          </Typography>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Collision Mode</InputLabel>
            <Select
              value={collisionMode}
              label="Collision Mode"
              onChange={(e: SelectChangeEvent) => setCollisionMode(e.target.value as 'SKIP' | 'OVERWRITE')}
            >
              <MenuItem value="SKIP">Skip existing items</MenuItem>
              <MenuItem value="OVERWRITE">Overwrite existing items</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleRestore}
            disabled={restoreMutation.isPending}
          >
            Restore
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
