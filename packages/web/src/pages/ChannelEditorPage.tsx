// ===========================================
// Channel Editor Page
// ===========================================
// Container for editing/creating channels with tabbed interface.

import { useState, useEffect, useRef, useCallback, type ReactNode, type SyntheticEvent } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import { useChannel, useCreateChannel, useUpdateChannel } from '../hooks/use-channels.js';
import { SummaryTab } from '../components/channels/SummaryTab.js';
import { SourceTab } from '../components/channels/SourceTab.js';
import { PlaceholderTab } from '../components/channels/PlaceholderTab.js';

// ----- Form Data Type -----

export interface ChannelFormData {
  name: string;
  description: string;
  enabled: boolean;
  inboundDataType: string;
  outboundDataType: string;
  sourceConnectorType: string;
  sourceConnectorProperties: Record<string, unknown>;
  initialState: string;
  responseMode: string;
}

const DEFAULT_VALUES: ChannelFormData = {
  name: '',
  description: '',
  enabled: false,
  inboundDataType: 'HL7V2',
  outboundDataType: 'HL7V2',
  sourceConnectorType: 'TCP_MLLP',
  sourceConnectorProperties: {},
  initialState: 'STOPPED',
  responseMode: 'AUTO_AFTER_DESTINATIONS',
};

// ----- Tab Panel -----

interface TabPanelProps {
  readonly children: ReactNode;
  readonly index: number;
  readonly value: number;
}

function TabPanel({ children, value, index }: TabPanelProps): ReactNode {
  if (value !== index) return null;
  return <Box sx={{ py: 3 }}>{children}</Box>;
}

// ----- Page Component -----

export function ChannelEditorPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = id !== undefined;

  const [activeTab, setActiveTab] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // API hooks
  const { data: channel, isLoading, isError, error: loadError } = useChannel(isEditMode ? id : null);
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const isSaving = createChannel.isPending || updateChannel.isPending;

  // Form
  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ChannelFormData>({ defaultValues: DEFAULT_VALUES });

  const enabledValue = watch('enabled');
  const nameValue = watch('name');
  const sourceConnectorType = watch('sourceConnectorType');
  const sourceConnectorProperties = watch('sourceConnectorProperties');

  // Track previous connector type to detect changes (not initial load)
  const prevConnectorTypeRef = useRef(sourceConnectorType);

  // Load channel data into form when available
  useEffect(() => {
    if (channel && isEditMode) {
      reset({
        name: channel.name,
        description: channel.description ?? '',
        enabled: channel.enabled,
        inboundDataType: channel.inboundDataType,
        outboundDataType: channel.outboundDataType,
        sourceConnectorType: channel.sourceConnectorType,
        sourceConnectorProperties: channel.sourceConnectorProperties,
        initialState: channel.initialState,
        responseMode: channel.responseMode,
      });
      prevConnectorTypeRef.current = channel.sourceConnectorType;
    }
  }, [channel, isEditMode, reset]);

  // Reset connector properties when connector type changes (user action, not initial load)
  useEffect(() => {
    if (sourceConnectorType !== prevConnectorTypeRef.current) {
      prevConnectorTypeRef.current = sourceConnectorType;
      setValue('sourceConnectorProperties', {}, { shouldDirty: true });
    }
  }, [sourceConnectorType, setValue]);

  // Navigation guard for unsaved changes
  const blocker = useBlocker(isDirty && !isSaving);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (!saveSuccess) return;
    const timer = setTimeout(() => { setSaveSuccess(false); }, 3000);
    return () => { clearTimeout(timer); };
  }, [saveSuccess]);

  const handleTabChange = (_event: SyntheticEvent, newValue: number): void => {
    setActiveTab(newValue);
  };

  const handlePropertiesChange = useCallback((properties: Record<string, unknown>): void => {
    setValue('sourceConnectorProperties', properties, { shouldDirty: true });
  }, [setValue]);

  const onSubmit = async (data: ChannelFormData): Promise<void> => {
    setSaveError(null);
    setSaveSuccess(false);

    try {
      if (isEditMode) {
        await updateChannel.mutateAsync({
          id,
          input: {
            name: data.name,
            description: data.description,
            enabled: data.enabled,
            inboundDataType: data.inboundDataType as 'HL7V2',
            outboundDataType: data.outboundDataType as 'HL7V2',
            sourceConnectorType: data.sourceConnectorType as 'TCP_MLLP',
            sourceConnectorProperties: data.sourceConnectorProperties,
            responseMode: data.responseMode as 'AUTO_AFTER_DESTINATIONS',
            properties: {
              initialState: data.initialState as 'STOPPED',
              messageStorageMode: 'DEVELOPMENT' as const,
              encryptData: false,
              removeContentOnCompletion: false,
              removeAttachmentsOnCompletion: false,
            },
            revision: channel!.revision,
          },
        });
        setSaveSuccess(true);
      } else {
        const created = await createChannel.mutateAsync({
          name: data.name,
          description: data.description,
          enabled: data.enabled,
          inboundDataType: data.inboundDataType as 'HL7V2',
          outboundDataType: data.outboundDataType as 'HL7V2',
          sourceConnectorType: data.sourceConnectorType as 'TCP_MLLP',
          sourceConnectorProperties: data.sourceConnectorProperties,
          responseMode: data.responseMode as 'AUTO_AFTER_DESTINATIONS',
        });
        navigate(`/channels/${created.id}`, { replace: true });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save channel');
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

  // Error loading channel
  if (isEditMode && isError) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load channel: {loadError instanceof Error ? loadError.message : 'Unknown error'}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => { navigate('/channels'); }}>
          Back to Channels
        </Button>
      </Box>
    );
  }

  const pageTitle = isEditMode ? (nameValue || 'Edit Channel') : 'New Channel';

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <IconButton onClick={() => { navigate('/channels'); }} aria-label="back to channels">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {pageTitle}
        </Typography>
        {isEditMode ? (
          <Typography
            variant="body2"
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              bgcolor: enabledValue ? 'success.dark' : 'action.disabledBackground',
              color: enabledValue ? 'success.contrastText' : 'text.secondary',
            }}
          >
            {enabledValue ? 'Enabled' : 'Disabled'}
          </Typography>
        ) : null}
        <Button
          variant="contained"
          startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
          disabled={isSaving || (!isDirty && isEditMode)}
          onClick={handleSubmit(onSubmit)}
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
          Channel saved successfully.
        </Alert>
      ) : null}

      {/* Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab label="Summary" />
          <Tab label="Source" />
          <Tab label="Destinations" />
          <Tab label="Scripts" />
          <Tab label="Advanced" />
        </Tabs>
      </Paper>

      {/* Tab content */}
      <Paper sx={{ p: 3 }}>
        <TabPanel value={activeTab} index={0}>
          <SummaryTab
            control={control}
            errors={errors}
            isEditMode={isEditMode}
            channelId={id}
            revision={channel?.revision}
          />
        </TabPanel>
        <TabPanel value={activeTab} index={1}>
          <SourceTab
            control={control}
            errors={errors}
            sourceConnectorType={sourceConnectorType}
            sourceConnectorProperties={sourceConnectorProperties}
            onPropertiesChange={handlePropertiesChange}
          />
        </TabPanel>
        <TabPanel value={activeTab} index={2}>
          <PlaceholderTab label="Destinations" />
        </TabPanel>
        <TabPanel value={activeTab} index={3}>
          <PlaceholderTab label="Scripts" />
        </TabPanel>
        <TabPanel value={activeTab} index={4}>
          <PlaceholderTab label="Advanced" />
        </TabPanel>
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
