// ===========================================
// Advanced Tab
// ===========================================
// Message storage, pruning, and custom metadata columns.

import { type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

const STORAGE_MODES = [
  { value: 'DEVELOPMENT', label: 'Development', description: 'Store everything (messages, maps, response)' },
  { value: 'PRODUCTION', label: 'Production', description: 'Store processed messages only' },
  { value: 'RAW', label: 'Raw', description: 'Store raw message data only' },
  { value: 'METADATA', label: 'Metadata', description: 'Store metadata only (no message content)' },
  { value: 'DISABLED', label: 'Disabled', description: 'No message storage' },
] as const;

const DATA_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'] as const;

export interface MetadataColumnFormValues {
  name: string;
  dataType: string;
  mappingExpression: string | null;
}

export interface AdvancedFormValues {
  messageStorageMode: string;
  encryptData: boolean;
  removeContentOnCompletion: boolean;
  removeAttachmentsOnCompletion: boolean;
  pruningEnabled: boolean;
  pruningMaxAgeDays: number | null;
  pruningArchiveEnabled: boolean;
  metadataColumns: readonly MetadataColumnFormValues[];
}

interface AdvancedTabProps {
  readonly values: AdvancedFormValues;
  readonly onChange: (updates: Partial<AdvancedFormValues>) => void;
}

export function AdvancedTab({ values, onChange }: AdvancedTabProps): ReactNode {
  // ----- Metadata columns helpers -----
  const handleAddColumn = (): void => {
    onChange({
      metadataColumns: [
        ...values.metadataColumns,
        { name: '', dataType: 'STRING', mappingExpression: null },
      ],
    });
  };

  const handleRemoveColumn = (index: number): void => {
    onChange({
      metadataColumns: values.metadataColumns.filter((_, i) => i !== index),
    });
  };

  const handleColumnChange = (index: number, field: keyof MetadataColumnFormValues, value: string | null): void => {
    onChange({
      metadataColumns: values.metadataColumns.map((col, i) =>
        i === index ? { ...col, [field]: value } : col,
      ),
    });
  };

  return (
    <Box>
      {/* Message Storage Section */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Message Storage
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <FormControl>
            <FormLabel>Storage Mode</FormLabel>
            <RadioGroup
              value={values.messageStorageMode}
              onChange={(e) => { onChange({ messageStorageMode: e.target.value }); }}
            >
              {STORAGE_MODES.map((mode) => (
                <FormControlLabel
                  key={mode.value}
                  value={mode.value}
                  control={<Radio />}
                  label={
                    <Box>
                      <Typography variant="body2">{mode.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {mode.description}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
          </FormControl>
        </Grid>

        <Grid item xs={12} md={6}>
          <FormControlLabel
            control={
              <Switch
                checked={values.encryptData}
                onChange={(_e, checked) => { onChange({ encryptData: checked }); }}
              />
            }
            label="Encrypt stored data"
            sx={{ mb: 2, display: 'block' }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={values.removeContentOnCompletion}
                onChange={(_e, checked) => { onChange({ removeContentOnCompletion: checked }); }}
              />
            }
            label="Remove content on completion"
            sx={{ mb: 2, display: 'block' }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={values.removeAttachmentsOnCompletion}
                onChange={(_e, checked) => { onChange({ removeAttachmentsOnCompletion: checked }); }}
              />
            }
            label="Remove attachments on completion"
            sx={{ display: 'block' }}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 3 }} />

      {/* Pruning Section */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        Message Pruning
      </Typography>

      <FormControlLabel
        control={
          <Switch
            checked={values.pruningEnabled}
            onChange={(_e, checked) => { onChange({ pruningEnabled: checked }); }}
          />
        }
        label="Enable message pruning"
        sx={{ mb: 2, display: 'block' }}
      />

      {values.pruningEnabled ? (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Max Age (days)"
              type="number"
              value={values.pruningMaxAgeDays ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const parsed = parseInt(e.target.value, 10);
                onChange({ pruningMaxAgeDays: Number.isNaN(parsed) ? null : parsed });
              }}
              helperText="Messages older than this will be pruned"
              fullWidth
              slotProps={{ htmlInput: { min: 1 } }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={values.pruningArchiveEnabled}
                  onChange={(_e, checked) => { onChange({ pruningArchiveEnabled: checked }); }}
                />
              }
              label="Archive before pruning"
            />
          </Grid>
        </Grid>
      ) : null}

      <Divider sx={{ my: 3 }} />

      {/* Custom Metadata Columns Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Custom Metadata Columns
        </Typography>
        <Tooltip title="Add column">
          <IconButton size="small" onClick={handleAddColumn} aria-label="add metadata column">
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {values.metadataColumns.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Data Type</TableCell>
                <TableCell>Mapping Expression</TableCell>
                <TableCell width={48} />
              </TableRow>
            </TableHead>
            <TableBody>
              {values.metadataColumns.map((col, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <TextField
                      value={col.name}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => { handleColumnChange(index, 'name', e.target.value); }}
                      size="small"
                      fullWidth
                      placeholder="Column name"
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={col.dataType}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => { handleColumnChange(index, 'dataType', e.target.value); }}
                      size="small"
                      select
                      fullWidth
                    >
                      {DATA_TYPES.map((dt) => (
                        <MenuItem key={dt} value={dt}>{dt}</MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={col.mappingExpression ?? ''}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        handleColumnChange(index, 'mappingExpression', e.target.value || null);
                      }}
                      size="small"
                      fullWidth
                      placeholder="e.g. msg['PID']['PID.3'].toString()"
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => { handleRemoveColumn(index); }}
                      aria-label="remove column"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
          No custom metadata columns. Click + to add one.
        </Typography>
      )}
    </Box>
  );
}
