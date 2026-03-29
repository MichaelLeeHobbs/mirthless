// ===========================================
// Channel Settings Tab
// ===========================================
// Combined channel identity, data config, and advanced settings with collapsible sections.

import { type ReactNode, type ChangeEvent } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { ChannelFormData } from '../../pages/ChannelEditorPage.js';
import type { AdvancedFormValues, MetadataColumnFormValues } from './AdvancedTab.js';
import { ChannelGroupChips } from './ChannelGroupChips.js';

const DATA_TYPES = ['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR'] as const;

const SOURCE_CONNECTOR_TYPES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'CHANNEL',
  'DICOM',
  'FHIR',
] as const;

const INITIAL_STATES = ['STARTED', 'STOPPED', 'PAUSED'] as const;

const STORAGE_MODES = [
  { value: 'DEVELOPMENT', label: 'Development', description: 'Store everything (messages, maps, response)' },
  { value: 'PRODUCTION', label: 'Production', description: 'Store processed messages only' },
  { value: 'RAW', label: 'Raw', description: 'Store raw message data only' },
  { value: 'METADATA', label: 'Metadata', description: 'Store metadata only (no message content)' },
  { value: 'DISABLED', label: 'Disabled', description: 'No message storage' },
] as const;

const METADATA_DATA_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'] as const;

interface SummaryTabProps {
  readonly control: Control<ChannelFormData>;
  readonly errors: FieldErrors<ChannelFormData>;
  readonly isEditMode: boolean;
  readonly channelId: string | undefined;
  readonly revision: number | undefined;
  readonly advancedValues: AdvancedFormValues;
  readonly onAdvancedChange: (updates: Partial<AdvancedFormValues>) => void;
}

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}

export function SummaryTab({ control, errors, isEditMode, channelId, revision, advancedValues, onAdvancedChange }: SummaryTabProps): ReactNode {
  // ----- Metadata column helpers -----
  const handleAddColumn = (): void => {
    onAdvancedChange({
      metadataColumns: [
        ...advancedValues.metadataColumns,
        { name: '', dataType: 'STRING', mappingExpression: null },
      ],
    });
  };

  const handleRemoveColumn = (index: number): void => {
    onAdvancedChange({
      metadataColumns: advancedValues.metadataColumns.filter((_, i) => i !== index),
    });
  };

  const handleColumnChange = (index: number, field: keyof MetadataColumnFormValues, value: string | null): void => {
    onAdvancedChange({
      metadataColumns: advancedValues.metadataColumns.map((col, i) =>
        i === index ? { ...col, [field]: value } : col,
      ),
    });
  };

  return (
    <Box>
      <Grid container spacing={3}>
        {/* Left column -- Identity & Description */}
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
            Channel Identity
          </Typography>

          <Controller
            name="name"
            control={control}
            rules={{ required: 'Name is required', maxLength: { value: 255, message: 'Max 255 characters' } }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Channel Name"
                error={Boolean(errors.name)}
                helperText={errors.name?.message}
                fullWidth
                sx={{ mb: 2 }}
              />
            )}
          />

          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Description"
                multiline
                rows={3}
                fullWidth
                sx={{ mb: 2 }}
              />
            )}
          />

          {isEditMode ? (
            <>
              <TextField
                label="Channel ID"
                value={channelId ?? ''}
                fullWidth
                sx={{ mb: 2 }}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => { copyToClipboard(channelId ?? ''); }}
                          aria-label="copy channel ID"
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                label="Revision"
                value={revision ?? ''}
                fullWidth
                sx={{ mb: 2 }}
                slotProps={{ input: { readOnly: true } }}
              />
            </>
          ) : null}
        </Grid>

        {/* Right column -- Data Types & Connector */}
        <Grid item xs={12} md={6}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
            Data Configuration
          </Typography>

          <Controller
            name="inboundDataType"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Inbound Data Type" select fullWidth sx={{ mb: 2 }}>
                {DATA_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name="outboundDataType"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Outbound Data Type" select fullWidth sx={{ mb: 2 }}>
                {DATA_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name="sourceConnectorType"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Source Connector Type" select fullWidth sx={{ mb: 2 }}>
                {SOURCE_CONNECTOR_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t}</MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name="initialState"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Initial State on Deploy" select fullWidth sx={{ mb: 2 }}>
                {INITIAL_STATES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>
      </Grid>

      {/* Group assignment (edit mode only) */}
      {isEditMode && channelId ? (
        <Box sx={{ mt: 1 }}>
          <ChannelGroupChips channelId={channelId} />
        </Box>
      ) : null}

      {/* --- Advanced Settings (collapsible) --- */}
      <Box sx={{ mt: 3 }}>
        {/* Message Storage */}
        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Message Storage</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControl>
                  <FormLabel>Storage Mode</FormLabel>
                  <RadioGroup
                    value={advancedValues.messageStorageMode}
                    onChange={(e) => { onAdvancedChange({ messageStorageMode: e.target.value }); }}
                  >
                    {STORAGE_MODES.map((mode) => (
                      <FormControlLabel
                        key={mode.value}
                        value={mode.value}
                        control={<Radio />}
                        label={
                          <Box>
                            <Typography variant="body2">{mode.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{mode.description}</Typography>
                          </Box>
                        }
                      />
                    ))}
                  </RadioGroup>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={<Switch checked={advancedValues.encryptData} onChange={(_e, checked) => { onAdvancedChange({ encryptData: checked }); }} />}
                  label="Encrypt stored data"
                  sx={{ mb: 2, display: 'block' }}
                />
                <FormControlLabel
                  control={<Switch checked={advancedValues.removeContentOnCompletion} onChange={(_e, checked) => { onAdvancedChange({ removeContentOnCompletion: checked }); }} />}
                  label="Remove content on completion"
                  sx={{ mb: 2, display: 'block' }}
                />
                <FormControlLabel
                  control={<Switch checked={advancedValues.removeAttachmentsOnCompletion} onChange={(_e, checked) => { onAdvancedChange({ removeAttachmentsOnCompletion: checked }); }} />}
                  label="Remove attachments on completion"
                  sx={{ display: 'block' }}
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Message Pruning */}
        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Message Pruning</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <FormControlLabel
              control={<Switch checked={advancedValues.pruningEnabled} onChange={(_e, checked) => { onAdvancedChange({ pruningEnabled: checked }); }} />}
              label="Enable message pruning"
              sx={{ mb: 2, display: 'block' }}
            />
            {advancedValues.pruningEnabled ? (
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Max Age (days)"
                    type="number"
                    value={advancedValues.pruningMaxAgeDays ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const parsed = parseInt(e.target.value, 10);
                      onAdvancedChange({ pruningMaxAgeDays: Number.isNaN(parsed) ? null : parsed });
                    }}
                    helperText="Messages older than this will be pruned"
                    fullWidth
                    slotProps={{ htmlInput: { min: 1 } }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={<Switch checked={advancedValues.pruningArchiveEnabled} onChange={(_e, checked) => { onAdvancedChange({ pruningArchiveEnabled: checked }); }} />}
                    label="Archive before pruning"
                  />
                </Grid>
              </Grid>
            ) : null}
          </AccordionDetails>
        </Accordion>

        {/* Script Execution */}
        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Script Execution</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Script Timeout (seconds)"
                  type="number"
                  value={advancedValues.scriptTimeoutSeconds}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 300) {
                      onAdvancedChange({ scriptTimeoutSeconds: parsed });
                    }
                  }}
                  helperText="Maximum execution time per script (1-300 seconds)"
                  fullWidth
                  slotProps={{ htmlInput: { min: 1, max: 300 } }}
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Custom Metadata Columns */}
        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Custom Metadata Columns</Typography>
              <Tooltip title="Add column">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleAddColumn(); }}
                  aria-label="add metadata column"
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            {advancedValues.metadataColumns.length > 0 ? (
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
                    {advancedValues.metadataColumns.map((col, index) => (
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
                            {METADATA_DATA_TYPES.map((dt) => (
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
          </AccordionDetails>
        </Accordion>
      </Box>
    </Box>
  );
}
