// ===========================================
// Alert Editor Page
// ===========================================
// Create/edit alert configuration with trigger, channels, actions, and templates.

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import { useAlert, useCreateAlert, useUpdateAlert } from '../hooks/use-alerts.js';
import { TriggerSection, type TriggerFormValues } from '../components/alerts/TriggerSection.js';
import { ChannelsSection } from '../components/alerts/ChannelsSection.js';
import { ActionsSection, type ActionFormValues } from '../components/alerts/ActionsSection.js';
import { TemplatesSection, type TemplateFormValues } from '../components/alerts/TemplatesSection.js';

// ----- Form Data -----

interface AlertFormData {
  name: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_FORM: AlertFormData = {
  name: '',
  description: '',
  enabled: true,
};

const DEFAULT_TRIGGER: TriggerFormValues = {
  errorTypes: ['ANY'],
  regex: '',
};

const DEFAULT_TEMPLATES: TemplateFormValues = {
  subjectTemplate: '',
  bodyTemplate: '',
  reAlertIntervalMs: null,
  maxAlerts: null,
};

// ----- Page Component -----

export function AlertEditorPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = id !== undefined;

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const formInitializedRef = useRef(false);

  // Extra form state (not managed by react-hook-form)
  const [trigger, setTrigger] = useState<TriggerFormValues>(DEFAULT_TRIGGER);
  const [channelIds, setChannelIds] = useState<readonly string[]>([]);
  const [actions, setActions] = useState<readonly ActionFormValues[]>([]);
  const [templates, setTemplates] = useState<TemplateFormValues>(DEFAULT_TEMPLATES);
  const [extraDirty, setExtraDirty] = useState(false);

  // API hooks
  const { data: alert, isLoading, isError, error: loadError } = useAlert(isEditMode ? id : null);
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const isSaving = createAlert.isPending || updateAlert.isPending;

  // Form
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty: formDirty },
  } = useForm<AlertFormData>({ defaultValues: DEFAULT_FORM });

  const isDirty = formDirty || extraDirty;
  const nameValue = watch('name');

  // Reset initialization guard when navigating to a different alert
  useEffect(() => {
    formInitializedRef.current = false;
  }, [id]);

  // Load alert data into form (only on initial load, not on refetch)
  useEffect(() => {
    if (alert && isEditMode && !formInitializedRef.current) {
      formInitializedRef.current = true;

      reset({
        name: alert.name,
        description: alert.description ?? '',
        enabled: alert.enabled,
      });

      setTrigger({
        errorTypes: [...alert.trigger.errorTypes],
        regex: alert.trigger.regex ?? '',
      });

      setChannelIds([...alert.channelIds]);

      setActions(alert.actions.map((a) => ({
        type: a.actionType as 'EMAIL' | 'CHANNEL',
        recipients: [...a.recipients],
        channelId: a.properties && typeof a.properties === 'object' && 'channelId' in a.properties
          ? String(a.properties['channelId'])
          : '',
      })));

      setTemplates({
        subjectTemplate: alert.subjectTemplate ?? '',
        bodyTemplate: alert.bodyTemplate ?? '',
        reAlertIntervalMs: alert.reAlertIntervalMs,
        maxAlerts: alert.maxAlerts,
      });

      setExtraDirty(false);
    }
  }, [alert, isEditMode, reset]);

  // Navigation guard
  const blocker = useBlocker(isDirty && !isSaving);

  // Clear success after 3s
  useEffect(() => {
    if (!saveSuccess) return;
    const timer = setTimeout(() => { setSaveSuccess(false); }, 3000);
    return () => { clearTimeout(timer); };
  }, [saveSuccess]);

  const handleTriggerChange = useCallback((updated: TriggerFormValues): void => {
    setTrigger(updated);
    setExtraDirty(true);
  }, []);

  const handleChannelIdsChange = useCallback((updated: readonly string[]): void => {
    setChannelIds(updated);
    setExtraDirty(true);
  }, []);

  const handleActionsChange = useCallback((updated: readonly ActionFormValues[]): void => {
    setActions(updated);
    setExtraDirty(true);
  }, []);

  const handleTemplatesChange = useCallback((updated: TemplateFormValues): void => {
    setTemplates(updated);
    setExtraDirty(true);
  }, []);

  const buildActionsPayload = (): Array<
    | { type: 'EMAIL'; recipients: string[] }
    | { type: 'CHANNEL'; channelId: string; recipients: string[] }
  > => {
    return actions.map((a) => {
      if (a.type === 'EMAIL') {
        return { type: 'EMAIL' as const, recipients: [...a.recipients] };
      }
      return {
        type: 'CHANNEL' as const,
        channelId: a.channelId,
        recipients: [...a.recipients],
      };
    });
  };

  const onSubmit = async (data: AlertFormData): Promise<void> => {
    setSaveError(null);
    setSaveSuccess(false);

    const triggerPayload = {
      type: 'CHANNEL_ERROR' as const,
      errorTypes: [...trigger.errorTypes] as ['ANY'],
      regex: trigger.regex || null,
    };

    try {
      if (isEditMode) {
        await updateAlert.mutateAsync({
          id,
          input: {
            name: data.name,
            description: data.description,
            enabled: data.enabled,
            trigger: triggerPayload,
            channelIds: [...channelIds],
            actions: buildActionsPayload(),
            subjectTemplate: templates.subjectTemplate || null,
            bodyTemplate: templates.bodyTemplate || null,
            reAlertIntervalMs: templates.reAlertIntervalMs,
            maxAlerts: templates.maxAlerts,
            revision: alert!.revision,
          },
        });
        setExtraDirty(false);
        setSaveSuccess(true);
      } else {
        const created = await createAlert.mutateAsync({
          name: data.name,
          description: data.description,
          enabled: data.enabled,
          trigger: triggerPayload,
          channelIds: [...channelIds],
          actions: buildActionsPayload(),
          subjectTemplate: templates.subjectTemplate || null,
          bodyTemplate: templates.bodyTemplate || null,
          reAlertIntervalMs: templates.reAlertIntervalMs,
          maxAlerts: templates.maxAlerts,
        });
        navigate(`/alerts/${created.id}`, { replace: true });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save alert');
    }
  };

  // Loading state for edit mode
  if (isEditMode && isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={300} height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={400} />
      </Box>
    );
  }

  // Error loading alert
  if (isEditMode && isError) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load alert: {loadError instanceof Error ? loadError.message : 'Unknown error'}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => { navigate('/alerts'); }}>
          Back to Alerts
        </Button>
      </Box>
    );
  }

  const pageTitle = isEditMode ? `Edit: ${nameValue || 'Alert'}` : 'New Alert';

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, overflow: 'hidden' }}>
        <IconButton onClick={() => { navigate('/alerts'); }} aria-label="back to alerts" sx={{ flexShrink: 0 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography
          variant="h5"
          component="h1"
          title={pageTitle}
          sx={{ fontWeight: 600, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
        >
          {pageTitle}
        </Typography>
        <Button
          variant="contained"
          startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
          disabled={isSaving || (!isDirty && isEditMode)}
          onClick={handleSubmit(onSubmit)}
          sx={{ flexShrink: 0 }}
        >
          {isEditMode ? 'Save' : 'Create'}
        </Button>
      </Box>

      {/* Status messages */}
      {saveError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => { setSaveError(null); }}>
          {saveError}
        </Alert>
      ) : null}
      {saveSuccess ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Alert saved successfully.
        </Alert>
      ) : null}

      {/* Form */}
      <Paper sx={{ p: 3 }}>
        {/* Basic Info */}
        <Typography variant="h6" gutterBottom>General</Typography>
        <Controller
          name="name"
          control={control}
          rules={{ required: 'Name is required' }}
          render={({ field }) => (
            <TextField
              {...field}
              label="Name"
              fullWidth
              size="small"
              error={!!errors.name}
              helperText={errors.name?.message}
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
              fullWidth
              size="small"
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />
          )}
        />
        <Controller
          name="enabled"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch checked={field.value} onChange={field.onChange} />}
              label="Enabled"
              sx={{ mb: 2 }}
            />
          )}
        />

        <Divider sx={{ my: 3 }} />
        <TriggerSection values={trigger} onChange={handleTriggerChange} />

        <Divider sx={{ my: 3 }} />
        <ChannelsSection channelIds={channelIds} onChange={handleChannelIdsChange} />

        <Divider sx={{ my: 3 }} />
        <ActionsSection actions={actions} onChange={handleActionsChange} />

        <Divider sx={{ my: 3 }} />
        <TemplatesSection values={templates} onChange={handleTemplatesChange} />
      </Paper>

      {/* Unsaved changes dialog */}
      <Dialog open={blocker.state === 'blocked'}>
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved changes. Are you sure you want to leave this page?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { blocker.reset?.(); }}>Stay</Button>
          <Button color="error" onClick={() => { blocker.proceed?.(); }}>Leave</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
