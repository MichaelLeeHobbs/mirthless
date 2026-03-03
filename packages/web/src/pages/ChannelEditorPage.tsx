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
import Tooltip from '@mui/material/Tooltip';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import HistoryIcon from '@mui/icons-material/History';
import type { CreateChannelInput, UpdateChannelInput } from '@mirthless/core-models';
import { useChannel, useCreateChannel, useUpdateChannel } from '../hooks/use-channels.js';
import { SummaryTab } from '../components/channels/SummaryTab.js';
import { SourceTab } from '../components/channels/SourceTab.js';
import { DestinationsTab } from '../components/channels/DestinationsTab.js';
import { ScriptsTab } from '../components/channels/ScriptsTab.js';
import { AdvancedTab, type AdvancedFormValues } from '../components/channels/AdvancedTab.js';
import type { DestinationFormValues } from '../components/channels/destinations/types.js';
import type { FilterFormValues, TransformerFormValues, FilterRuleFormValues, TransformerStepFormValues } from '../components/channels/source/types.js';
import { createDefaultFilter, createDefaultTransformer } from '../components/channels/source/types.js';
import { RevisionHistoryDialog } from '../components/channels/RevisionHistoryDialog.js';
import { PageBreadcrumbs } from '../components/common/PageBreadcrumbs.js';
import { ChannelGroupChips } from '../components/channels/ChannelGroupChips.js';

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

const DEFAULT_SCRIPTS = {
  deploy: '',
  undeploy: '',
  preprocessor: '',
  postprocessor: '',
};

const DEFAULT_ADVANCED: AdvancedFormValues = {
  messageStorageMode: 'DEVELOPMENT',
  encryptData: false,
  removeContentOnCompletion: false,
  removeAttachmentsOnCompletion: false,
  pruningEnabled: false,
  pruningMaxAgeDays: null,
  pruningArchiveEnabled: false,
  scriptTimeoutSeconds: 30,
  metadataColumns: [],
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Extra form state (not managed by react-hook-form)
  const [destinations, setDestinations] = useState<readonly DestinationFormValues[]>([]);
  const [scripts, setScripts] = useState(DEFAULT_SCRIPTS);
  const [advanced, setAdvanced] = useState<AdvancedFormValues>(DEFAULT_ADVANCED);
  const [sourceFilter, setSourceFilter] = useState<FilterFormValues>(createDefaultFilter());
  const [sourceTransformer, setSourceTransformer] = useState<TransformerFormValues>(createDefaultTransformer());
  // destFilters/destTransformers are now embedded in DestinationFormValues

  // Track manual dirty state for non-RHF fields
  const [extraDirty, setExtraDirty] = useState(false);

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
    formState: { errors, isDirty: formDirty },
  } = useForm<ChannelFormData>({ defaultValues: DEFAULT_VALUES });

  const isDirty = formDirty || extraDirty;

  const enabledValue = watch('enabled');
  const nameValue = watch('name');
  const sourceConnectorType = watch('sourceConnectorType');
  const sourceConnectorProperties = watch('sourceConnectorProperties');

  // Track previous connector type to detect user-initiated changes
  const prevConnectorTypeRef = useRef(sourceConnectorType);
  // Guard: skip type-change reset when form is being populated from server data
  const isResettingRef = useRef(false);

  // Load channel data into form when available
  useEffect(() => {
    if (channel && isEditMode) {
      isResettingRef.current = true;
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

      // Load destinations (with embedded filter/transformer)
      setDestinations(channel.destinations.map((d) => {
        const dFilter = channel.filters.find((f) => f.connectorId === d.id);
        const dTransformer = channel.transformers.find((t) => t.connectorId === d.id);

        return {
          name: d.name,
          enabled: d.enabled,
          connectorType: d.connectorType,
          properties: d.properties,
          queueMode: d.queueMode,
          retryCount: d.retryCount,
          retryIntervalMs: d.retryIntervalMs,
          rotateQueue: d.rotateQueue,
          queueThreadCount: d.queueThreadCount,
          waitForPrevious: d.waitForPrevious,
          filter: dFilter
            ? {
                rules: dFilter.rules.map((r) => ({
                  enabled: r.enabled,
                  name: r.name ?? '',
                  operator: (r.operator as 'AND' | 'OR') ?? 'AND',
                  type: (r.type as 'JAVASCRIPT' | 'RULE_BUILDER') ?? 'JAVASCRIPT',
                  script: r.script ?? '',
                  field: r.field ?? '',
                  condition: r.condition ?? '',
                  values: r.values ? [...r.values] : [],
                })),
              }
            : createDefaultFilter(),
          transformer: dTransformer
            ? {
                inboundDataType: dTransformer.inboundDataType,
                outboundDataType: dTransformer.outboundDataType,
                steps: dTransformer.steps.map((s) => ({
                  enabled: s.enabled,
                  name: s.name ?? '',
                  type: (s.type as 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER') ?? 'JAVASCRIPT',
                  script: s.script ?? '',
                  sourceField: s.sourceField ?? '',
                  targetField: s.targetField ?? '',
                  defaultValue: s.defaultValue ?? '',
                  mapping: s.mapping ?? '',
                })),
              }
            : createDefaultTransformer(),
        };
      }));

      // Load scripts
      const scriptMap = { ...DEFAULT_SCRIPTS };
      for (const s of channel.scripts) {
        const key = s.scriptType.toLowerCase() as keyof typeof scriptMap;
        if (key in scriptMap) {
          scriptMap[key] = s.script;
        }
      }
      setScripts(scriptMap);

      // Load advanced settings
      setAdvanced({
        messageStorageMode: channel.messageStorageMode,
        encryptData: channel.encryptData,
        removeContentOnCompletion: channel.removeContentOnCompletion,
        removeAttachmentsOnCompletion: channel.removeAttachmentsOnCompletion,
        pruningEnabled: channel.pruningEnabled,
        pruningMaxAgeDays: channel.pruningMaxAgeDays,
        pruningArchiveEnabled: channel.pruningArchiveEnabled,
        scriptTimeoutSeconds: channel.scriptTimeoutSeconds ?? 30,
        metadataColumns: channel.metadataColumns.map((c) => ({
          name: c.name,
          dataType: c.dataType,
          mappingExpression: c.mappingExpression,
        })),
      });

      // Load source filter (connectorId === null)
      const srcFilter = channel.filters.find((f) => f.connectorId === null);
      if (srcFilter) {
        setSourceFilter({
          rules: srcFilter.rules.map((r) => ({
            enabled: r.enabled,
            name: r.name ?? '',
            operator: (r.operator as 'AND' | 'OR') ?? 'AND',
            type: (r.type as 'JAVASCRIPT' | 'RULE_BUILDER') ?? 'JAVASCRIPT',
            script: r.script ?? '',
            field: r.field ?? '',
            condition: r.condition ?? '',
            values: r.values ? [...r.values] : [],
          })),
        });
      } else {
        setSourceFilter(createDefaultFilter());
      }

      // Load source transformer (connectorId === null)
      const srcTransformer = channel.transformers.find((t) => t.connectorId === null);
      if (srcTransformer) {
        setSourceTransformer({
          inboundDataType: srcTransformer.inboundDataType,
          outboundDataType: srcTransformer.outboundDataType,
          steps: srcTransformer.steps.map((s) => ({
            enabled: s.enabled,
            name: s.name ?? '',
            type: (s.type as 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER') ?? 'JAVASCRIPT',
            script: s.script ?? '',
            sourceField: s.sourceField ?? '',
            targetField: s.targetField ?? '',
            defaultValue: s.defaultValue ?? '',
            mapping: s.mapping ?? '',
          })),
        });
      } else {
        setSourceTransformer(createDefaultTransformer());
      }

      setExtraDirty(false);
    }
  }, [channel, isEditMode, reset]);

  // Reset connector properties when connector type changes (user action only)
  useEffect(() => {
    if (isResettingRef.current) {
      isResettingRef.current = false;
      return;
    }
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

  const handleDestinationsChange = useCallback((updated: readonly DestinationFormValues[]): void => {
    setDestinations(updated);
    setExtraDirty(true);
  }, []);

  const handleScriptsChange = useCallback((updated: typeof DEFAULT_SCRIPTS): void => {
    setScripts(updated);
    setExtraDirty(true);
  }, []);

  const handleAdvancedChange = useCallback((updates: Partial<AdvancedFormValues>): void => {
    setAdvanced((prev) => ({ ...prev, ...updates }));
    setExtraDirty(true);
  }, []);

  const handleSourceFilterChange = useCallback((filter: FilterFormValues): void => {
    setSourceFilter(filter);
    setExtraDirty(true);
  }, []);

  const handleSourceTransformerChange = useCallback((transformer: TransformerFormValues): void => {
    setSourceTransformer(transformer);
    setExtraDirty(true);
  }, []);

  const buildDestinationsPayload = (): Array<{
    name: string;
    enabled: boolean;
    connectorType: 'TCP_MLLP';
    properties: Record<string, unknown>;
    queueMode: 'NEVER';
    retryCount: number;
    retryIntervalMs: number;
    rotateQueue: boolean;
    queueThreadCount: number;
    waitForPrevious: boolean;
  }> => {
    return destinations.map((d) => ({
      name: d.name,
      enabled: d.enabled,
      connectorType: d.connectorType as 'TCP_MLLP',
      properties: d.properties,
      queueMode: d.queueMode as 'NEVER',
      retryCount: d.retryCount,
      retryIntervalMs: d.retryIntervalMs,
      rotateQueue: d.rotateQueue,
      queueThreadCount: d.queueThreadCount,
      waitForPrevious: d.waitForPrevious,
    }));
  };

  const buildMetadataPayload = (): Array<{
    name: string;
    dataType: 'STRING';
    mappingExpression: string | null;
  }> => {
    return advanced.metadataColumns
      .filter((c) => c.name.trim() !== '')
      .map((c) => ({
        name: c.name,
        dataType: c.dataType as 'STRING',
        mappingExpression: c.mappingExpression,
      }));
  };

  const mapRulesToPayload = (rules: readonly FilterRuleFormValues[]): Array<{
    enabled: boolean;
    name: string | undefined;
    operator: 'AND';
    type: 'JAVASCRIPT';
    script: string | null;
    field: string | null;
    condition: string | null;
    values: string[] | null;
  }> => {
    return rules.map((r) => ({
      enabled: r.enabled,
      name: r.name || undefined,
      operator: r.operator as 'AND',
      type: r.type as 'JAVASCRIPT',
      script: r.script || null,
      field: r.field || null,
      condition: r.condition || null,
      values: r.values.length > 0 ? [...r.values] : null,
    }));
  };

  const mapStepsToPayload = (steps: readonly TransformerStepFormValues[]): Array<{
    enabled: boolean;
    name: string | undefined;
    type: 'JAVASCRIPT';
    script: string | null;
    sourceField: string | null;
    targetField: string | null;
    defaultValue: string | null;
    mapping: string | null;
  }> => {
    return steps.map((s) => ({
      enabled: s.enabled,
      name: s.name || undefined,
      type: s.type as 'JAVASCRIPT',
      script: s.script || null,
      sourceField: s.sourceField || null,
      targetField: s.targetField || null,
      defaultValue: s.defaultValue || null,
      mapping: s.mapping || null,
    }));
  };

  const buildFiltersPayload = (): unknown[] => {
    const result: unknown[] = [];

    // Source filter
    if (sourceFilter.rules.length > 0) {
      result.push({
        connectorId: null,
        metaDataId: null,
        rules: mapRulesToPayload(sourceFilter.rules),
      });
    }

    // Destination filters
    for (let i = 0; i < destinations.length; i++) {
      const dest = destinations[i]!;
      if (dest.filter.rules.length > 0) {
        result.push({
          connectorId: null,
          metaDataId: i + 1,
          rules: mapRulesToPayload(dest.filter.rules),
        });
      }
    }

    return result;
  };

  const buildTransformersPayload = (): unknown[] => {
    const result: unknown[] = [];

    // Source transformer
    if (sourceTransformer.steps.length > 0 || sourceTransformer.inboundDataType !== 'HL7V2' || sourceTransformer.outboundDataType !== 'HL7V2') {
      result.push({
        connectorId: null,
        metaDataId: null,
        inboundDataType: sourceTransformer.inboundDataType,
        outboundDataType: sourceTransformer.outboundDataType,
        inboundProperties: {},
        outboundProperties: {},
        inboundTemplate: null,
        outboundTemplate: null,
        steps: mapStepsToPayload(sourceTransformer.steps),
      });
    }

    // Destination transformers
    for (let i = 0; i < destinations.length; i++) {
      const dest = destinations[i]!;
      const t = dest.transformer;
      if (t.steps.length > 0 || t.inboundDataType !== 'HL7V2' || t.outboundDataType !== 'HL7V2') {
        result.push({
          connectorId: null,
          metaDataId: i + 1,
          inboundDataType: t.inboundDataType,
          outboundDataType: t.outboundDataType,
          inboundProperties: {},
          outboundProperties: {},
          inboundTemplate: null,
          outboundTemplate: null,
          steps: mapStepsToPayload(t.steps),
        });
      }
    }

    return result;
  };

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
              messageStorageMode: advanced.messageStorageMode as 'DEVELOPMENT',
              encryptData: advanced.encryptData,
              removeContentOnCompletion: advanced.removeContentOnCompletion,
              removeAttachmentsOnCompletion: advanced.removeAttachmentsOnCompletion,
              pruningEnabled: advanced.pruningEnabled,
              pruningMaxAgeDays: advanced.pruningMaxAgeDays,
              pruningArchiveEnabled: advanced.pruningArchiveEnabled,
              scriptTimeoutSeconds: advanced.scriptTimeoutSeconds,
            },
            scripts: {
              deploy: scripts.deploy || null,
              undeploy: scripts.undeploy || null,
              preprocessor: scripts.preprocessor || null,
              postprocessor: scripts.postprocessor || null,
            },
            destinations: buildDestinationsPayload(),
            metadataColumns: buildMetadataPayload(),
            filters: buildFiltersPayload() as UpdateChannelInput['filters'],
            transformers: buildTransformersPayload() as UpdateChannelInput['transformers'],
            revision: channel!.revision,
          },
        });
        setExtraDirty(false);
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
          destinations: buildDestinationsPayload(),
          metadataColumns: buildMetadataPayload(),
          filters: buildFiltersPayload() as CreateChannelInput['filters'],
          transformers: buildTransformersPayload() as CreateChannelInput['transformers'],
          scripts: {
            deploy: scripts.deploy || null,
            undeploy: scripts.undeploy || null,
            preprocessor: scripts.preprocessor || null,
            postprocessor: scripts.postprocessor || null,
          },
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
      <PageBreadcrumbs items={[
        { label: 'Channels', href: '/channels' },
        { label: isEditMode ? (nameValue || 'Edit Channel') : 'New Channel' },
      ]} />
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, overflow: 'hidden' }}>
        <IconButton onClick={() => { navigate('/channels'); }} aria-label="back to channels" sx={{ flexShrink: 0 }}>
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
        {isEditMode ? (
          <Typography
            variant="body2"
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              flexShrink: 0,
              bgcolor: enabledValue ? 'success.dark' : 'action.disabledBackground',
              color: enabledValue ? 'success.contrastText' : 'text.secondary',
            }}
          >
            {enabledValue ? 'Enabled' : 'Disabled'}
          </Typography>
        ) : null}
        {isEditMode ? (
          <Tooltip title="Revision History">
            <IconButton onClick={() => { setHistoryOpen(true); }} aria-label="revision history" sx={{ flexShrink: 0 }}>
              <HistoryIcon />
            </IconButton>
          </Tooltip>
        ) : null}
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
          {isEditMode && id ? (
            <ChannelGroupChips channelId={id} />
          ) : null}
        </TabPanel>
        <TabPanel value={activeTab} index={1}>
          <SourceTab
            control={control}
            errors={errors}
            sourceConnectorType={sourceConnectorType}
            sourceConnectorProperties={sourceConnectorProperties}
            onPropertiesChange={handlePropertiesChange}
            sourceFilter={sourceFilter}
            onSourceFilterChange={handleSourceFilterChange}
            sourceTransformer={sourceTransformer}
            onSourceTransformerChange={handleSourceTransformerChange}
          />
        </TabPanel>
        <TabPanel value={activeTab} index={2}>
          <DestinationsTab
            destinations={destinations}
            onChange={handleDestinationsChange}
          />
        </TabPanel>
        <TabPanel value={activeTab} index={3}>
          <ScriptsTab scripts={scripts} onChange={handleScriptsChange} />
        </TabPanel>
        <TabPanel value={activeTab} index={4}>
          <AdvancedTab values={advanced} onChange={handleAdvancedChange} />
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

      {/* Revision History */}
      {isEditMode && id ? (
        <RevisionHistoryDialog
          channelId={id}
          open={historyOpen}
          onClose={() => { setHistoryOpen(false); }}
        />
      ) : null}
    </Box>
  );
}
