import { useMemo, useCallback, type ReactNode, type ChangeEvent } from 'react';
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
import Alert from '@mui/material/Alert';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ChannelFormData } from '../../pages/ChannelEditorPage.js';
import type { AdvancedFormValues } from './AdvancedTab.js';
import { useChannelGroups, useGroupMemberships, useSetChannelGroups } from '../../hooks/use-channel-groups.js';
import { SOURCE_CONNECTOR_TYPES } from '@galvanigraph/core-models';
import { useNotification } from '../../stores/notification.store.js';
import { errorMessage } from '../../lib/error-message.js';
import { isSameGroupSet, multiGroupNote } from '../../lib/group-membership.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { PERMISSION } from '../../lib/permissions.js';

const DATA_TYPES = ['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR', 'X12'] as const;

const INITIAL_STATES = ['STARTED', 'STOPPED', 'PAUSED'] as const;

const STORAGE_MODES = [
  { value: 'DEVELOPMENT', label: 'Development', description: 'Store everything (incl. maps + debug content)' },
  { value: 'PRODUCTION', label: 'Production', description: 'Store raw, sent, response + errors (supports queuing)' },
  { value: 'RAW', label: 'Raw', description: 'Store raw message + errors only (no queued destinations)' },
  { value: 'METADATA', label: 'Metadata', description: 'Metadata only — no content, no queued destinations' },
  { value: 'DISABLED', label: 'Disabled', description: 'No message storage — no queued destinations' },
] as const;

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

const NONE_GROUP = '__none__';

export function SummaryTab({ control, errors, isEditMode, channelId, revision, advancedValues, onAdvancedChange }: SummaryTabProps): ReactNode {
  const groupsQuery = useChannelGroups();
  const membershipsQuery = useGroupMemberships();
  const setChannelGroups = useSetChannelGroups();
  const { notify } = useNotification();

  const currentGroupIds = useMemo((): readonly string[] => {
    return (membershipsQuery.data ?? []).filter((m) => m.channelId === channelId).map((m) => m.channelGroupId);
  }, [membershipsQuery.data, channelId]);

  const currentGroupId = currentGroupIds[0] ?? NONE_GROUP;
  const canChangeGroup = usePermissions().has(PERMISSION.CHANNELS_WRITE);
  const groupNote = multiGroupNote(currentGroupIds.map((id) => groupsQuery.data?.find((g) => g.id === id)?.name ?? id));

  const handleGroupChange = useCallback(async (newGroupId: string): Promise<void> => {
    if (!channelId) return;
    const groupIds = newGroupId === NONE_GROUP ? [] : [newGroupId];
    if (isSameGroupSet(groupIds, currentGroupIds)) return;

    try {
      // One call replaces every membership (a channel has one group in the UI,
      // D-126), so a failure leaves the channel's groups as they were (#223).
      await setChannelGroups.mutateAsync({ channelId, groupIds });
      notify('Channel group updated', 'success');
    } catch (e) {
      notify(errorMessage(e, 'Failed to update channel group'), 'error');
    }
  }, [channelId, currentGroupIds, setChannelGroups, notify]);

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid
          size={{
            xs: 12,
            md: 6
          }}>
          <Typography
            variant="subtitle2"
            sx={{
              color: 'text.secondary',
              mb: 2
            }}>
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

              <TextField
                label="Channel Group"
                select
                fullWidth
                sx={{ mb: 2 }}
                value={currentGroupId}
                onChange={(e) => { handleGroupChange(e.target.value); }}
                disabled={!canChangeGroup || groupsQuery.isLoading || membershipsQuery.isLoading}
                helperText={groupNote}
              >
                <MenuItem value={NONE_GROUP}><em>None</em></MenuItem>
                {(groupsQuery.data ?? []).map((g) => (
                  <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
                ))}
              </TextField>
            </>
          ) : null}
        </Grid>

        <Grid
          size={{
            xs: 12,
            md: 6
          }}>
          <Typography
            variant="subtitle2"
            sx={{
              color: 'text.secondary',
              mb: 2
            }}>
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

      <Box sx={{ mt: 3 }}>
        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Message Storage</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid
                size={{
                  xs: 12,
                  md: 6
                }}>
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
                            <Typography variant="caption" sx={{
                              color: 'text.secondary'
                            }}>{mode.description}</Typography>
                          </Box>
                        }
                      />
                    ))}
                  </RadioGroup>
                </FormControl>
              </Grid>
              <Grid
                size={{
                  xs: 12,
                  md: 6
                }}>
                <FormControlLabel
                  control={<Switch checked={advancedValues.encryptData} onChange={(_e, checked) => { onAdvancedChange({ encryptData: checked }); }} />}
                  label="Encrypt stored data"
                  sx={{ mb: 2, display: 'block' }}
                />
                <FormControlLabel
                  control={<Switch checked={advancedValues.removeContentOnCompletion} onChange={(_e, checked) => { onAdvancedChange({ removeContentOnCompletion: checked }); }} />}
                  label="Remove content on completion"
                  sx={{ display: 'block' }}
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

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
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
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
                <Grid size={12}>
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Pruning <strong>permanently deletes</strong> messages older than the age above,
                    including message content (PHI). There is no archive step — export any messages
                    you need to retain before they are pruned.
                  </Alert>
                </Grid>
              </Grid>
            ) : null}
          </AccordionDetails>
        </Accordion>

        <Accordion defaultExpanded={false}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Script Execution</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid
                size={{
                  xs: 12,
                  md: 6
                }}>
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
      </Box>
    </Box>
  );
}
