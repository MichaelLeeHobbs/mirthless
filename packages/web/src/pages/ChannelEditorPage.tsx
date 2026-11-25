import { useAddressId } from '../hooks/use-address-id.js';
import { useBeforeUnload } from '../hooks/use-beforeunload.js';
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode, type SyntheticEvent } from 'react';
import { useNavigate, useBlocker } from 'react-router';
import { useForm } from 'react-hook-form';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
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
import { type CreateChannelInput, type ScriptLanguageCode, type UpdateChannelInput } from '@galvanigraph/core-models';
import { useChannel, useCreateChannel, useUpdateChannel, type ChannelDetail } from '../hooks/use-channels.js';
import { useNewChannelGroups } from '../hooks/use-new-channel-groups.js';
import { NewChannelGroupField } from '../components/channels/NewChannelGroupField.js';
import { AccessTab } from '../components/channels/AccessTab.js';
import type { ScriptsFormValues } from '../components/channels/ScriptsTab.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { PERMISSION } from '../lib/permissions.js';
import { SummaryTab } from '../components/channels/SummaryTab.js';
import { SourceTab } from '../components/channels/SourceTab.js';
import { DestinationsTab } from '../components/channels/DestinationsTab.js';
import { ScriptsTab } from '../components/channels/ScriptsTab.js';
import type { AdvancedFormValues } from '../components/channels/AdvancedTab.js';
import type { DestinationFormValues } from '../components/channels/destinations/types.js';
import type { FilterFormValues, TransformerFormValues, FilterRuleFormValues, TransformerStepFormValues } from '../components/channels/source/types.js';
import { createDefaultFilter, createDefaultTransformer, transformerHasContent } from '../components/channels/source/types.js';
import { NEW_CHANNEL_SCRIPT_LANGUAGES, loadedScriptLanguage } from '../lib/script-language.js';
import { RevisionHistoryDialog } from '../components/channels/RevisionHistoryDialog.js';
import { ScriptDataTypeContext, ScriptTestSampleContext } from '../components/editors/script-context.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ChannelHealth } from '../components/channels/ChannelHealth.js';
import Chip from '@mui/material/Chip';

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

const DEFAULT_SCRIPTS: ScriptsFormValues = {
  deploy: '',
  undeploy: '',
  preprocessor: '',
  postprocessor: '',
  languages: { ...NEW_CHANNEL_SCRIPT_LANGUAGES },
};

type ApiFilterRule = ChannelDetail['filters'][number]['rules'][number];
type ApiTransformerStep = ChannelDetail['transformers'][number]['steps'][number];

function ruleFromApi(r: ApiFilterRule): FilterRuleFormValues {
  return {
    enabled: r.enabled,
    name: r.name ?? '',
    operator: (r.operator as 'AND' | 'OR') ?? 'AND',
    type: (r.type as 'JAVASCRIPT' | 'RULE_BUILDER') ?? 'JAVASCRIPT',
    script: r.script ?? '',
    language: loadedScriptLanguage(r.script, r.language),
    field: r.field ?? '',
    condition: r.condition ?? '',
    values: r.values ? [...r.values] : [],
  };
}

function stepFromApi(s: ApiTransformerStep): TransformerStepFormValues {
  return {
    enabled: s.enabled,
    name: s.name ?? '',
    type: (s.type as 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER') ?? 'JAVASCRIPT',
    script: s.script ?? '',
    language: loadedScriptLanguage(s.script, s.language),
    sourceField: s.sourceField ?? '',
    targetField: s.targetField ?? '',
    defaultValue: s.defaultValue ?? '',
    mapping: s.mapping ?? '',
  };
}

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

interface TabPanelProps {
  readonly children: ReactNode;
  readonly index: number;
  readonly value: number;
}

function TabPanel({ children, value, index }: TabPanelProps): ReactNode {
  if (value !== index) return null;
  return <Box>{children}</Box>;
}

export function ChannelEditorPage(): ReactNode {
  const id = useAddressId();
  const navigate = useNavigate();
  const isEditMode = id !== undefined;
  // Asked only of a writer scoped to several groups (D-310).
  const [newGroupId, setNewGroupId] = useState('');
  const needsGroup = useNewChannelGroups() !== null;

  const [activeTab, setActiveTab] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [destinations, setDestinations] = useState<readonly DestinationFormValues[]>([]);
  const [scripts, setScripts] = useState(DEFAULT_SCRIPTS);
  const [advanced, setAdvanced] = useState<AdvancedFormValues>(DEFAULT_ADVANCED);
  const [sourceFilter, setSourceFilter] = useState<FilterFormValues>(createDefaultFilter());
  const [sourceTransformer, setSourceTransformer] = useState<TransformerFormValues>(createDefaultTransformer());

  const [extraDirty, setExtraDirty] = useState(false);

  const { data: channel, isLoading, isError, error: loadError } = useChannel(isEditMode ? id : null);
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const isSaving = createChannel.isPending || updateChannel.isPending;
  const { has: hasPermission } = usePermissions();
  const canWrite = hasPermission(PERMISSION.CHANNELS_WRITE);
  // Who can access a channel lists people and their roles: users:read (D-310).
  const canSeeAccess = hasPermission(PERMISSION.USERS_READ);

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
  const inboundDataType = watch('inboundDataType');
  // One sample message for every script's test run on this page; memory only (PHI).
  const [sampleMessage, setSampleMessage] = useState('');
  const testSample = useMemo(
    () => ({ channelId: id, sample: sampleMessage, setSample: setSampleMessage }),
    [id, sampleMessage],
  );
  const sourceConnectorProperties = watch('sourceConnectorProperties');

  const prevConnectorTypeRef = useRef(sourceConnectorType);
  // Set while loading from the server, so the type-change effect keeps the loaded properties.
  const isResettingRef = useRef(false);

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

      setDestinations(channel.destinations.map((d) => {
        const dFilter = channel.filters.find((f) => f.connectorId === d.id);
        const dTransformer = channel.transformers.find((t) => t.connectorId === d.id);

        return {
          id: d.id,
          metaDataId: d.metaDataId,
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
                rules: dFilter.rules.map(ruleFromApi),
              }
            : createDefaultFilter(),
          transformer: dTransformer
            ? {
                inboundDataType: dTransformer.inboundDataType,
                outboundDataType: dTransformer.outboundDataType,
                inboundTemplate: dTransformer.inboundTemplate ?? null,
                outboundTemplate: dTransformer.outboundTemplate ?? null,
                inboundProperties: (dTransformer.inboundProperties as Record<string, unknown> | undefined) ?? {},
                outboundProperties: (dTransformer.outboundProperties as Record<string, unknown> | undefined) ?? {},
                steps: dTransformer.steps.map(stepFromApi),
              }
            : createDefaultTransformer(),
          responseTransformer: d.responseTransformer ?? '',
          responseTransformerLanguage: loadedScriptLanguage(d.responseTransformer, d.responseTransformerLanguage),
        };
      }));

      const scriptMap: ScriptsFormValues = { ...DEFAULT_SCRIPTS, languages: { ...DEFAULT_SCRIPTS.languages } };
      for (const s of channel.scripts) {
        const key = s.scriptType.toLowerCase() as keyof ScriptsFormValues['languages'];
        if (key in scriptMap.languages) {
          scriptMap[key] = s.script;
          scriptMap.languages[key] = loadedScriptLanguage(s.script, s.language);
        }
      }
      setScripts(scriptMap);

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

      const srcFilter = channel.filters.find((f) => f.connectorId === null);
      if (srcFilter) {
        setSourceFilter({
          rules: srcFilter.rules.map(ruleFromApi),
        });
      } else {
        setSourceFilter(createDefaultFilter());
      }

      const srcTransformer = channel.transformers.find((t) => t.connectorId === null);
      if (srcTransformer) {
        setSourceTransformer({
          inboundDataType: srcTransformer.inboundDataType,
          outboundDataType: srcTransformer.outboundDataType,
          inboundTemplate: srcTransformer.inboundTemplate ?? null,
          outboundTemplate: srcTransformer.outboundTemplate ?? null,
          inboundProperties: (srcTransformer.inboundProperties as Record<string, unknown> | undefined) ?? {},
          outboundProperties: (srcTransformer.outboundProperties as Record<string, unknown> | undefined) ?? {},
          steps: srcTransformer.steps.map(stepFromApi),
        });
      } else {
        setSourceTransformer(createDefaultTransformer());
      }

      setExtraDirty(false);
    }
  }, [channel, isEditMode, reset]);

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

  const blocker = useBlocker(isDirty && !isSaving);
  useBeforeUnload(isDirty && !isSaving);

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
    id: string;
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
    responseTransformer: string | null;
    responseTransformerLanguage: ScriptLanguageCode;
  }> => {
    return destinations.map((d) => ({
      id: d.id,
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
      responseTransformer: d.responseTransformer.trim() ? d.responseTransformer : null,
      responseTransformerLanguage: d.responseTransformerLanguage,
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
    language: ScriptLanguageCode;
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
      language: r.language,
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
    language: ScriptLanguageCode;
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
      language: s.language,
      sourceField: s.sourceField || null,
      targetField: s.targetField || null,
      defaultValue: s.defaultValue || null,
      mapping: s.mapping || null,
    }));
  };

  const buildFiltersPayload = (): unknown[] => {
    const result: unknown[] = [];

    if (sourceFilter.rules.length > 0) {
      result.push({
        connectorId: null,
        rules: mapRulesToPayload(sourceFilter.rules),
      });
    }

    for (const dest of destinations) {
      if (dest.filter.rules.length > 0) {
        result.push({
          connectorId: dest.id,
          rules: mapRulesToPayload(dest.filter.rules),
        });
      }
    }

    return result;
  };

  const buildTransformersPayload = (): unknown[] => {
    const result: unknown[] = [];

    if (transformerHasContent(sourceTransformer)) {
      result.push({
        connectorId: null,
        inboundDataType: sourceTransformer.inboundDataType,
        outboundDataType: sourceTransformer.outboundDataType,
        inboundProperties: sourceTransformer.inboundProperties,
        outboundProperties: sourceTransformer.outboundProperties,
        inboundTemplate: sourceTransformer.inboundTemplate,
        outboundTemplate: sourceTransformer.outboundTemplate,
        steps: mapStepsToPayload(sourceTransformer.steps),
      });
    }

    for (const dest of destinations) {
      const t = dest.transformer;
      if (transformerHasContent(t)) {
        result.push({
          connectorId: dest.id,
          inboundDataType: t.inboundDataType,
          outboundDataType: t.outboundDataType,
          inboundProperties: t.inboundProperties,
          outboundProperties: t.outboundProperties,
          inboundTemplate: t.inboundTemplate,
          outboundTemplate: t.outboundTemplate,
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
              languages: scripts.languages,
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
            languages: scripts.languages,
          },
          ...(newGroupId === '' ? {} : { groupId: newGroupId }),
        });
        navigate(`/channels/${created.id}`, { replace: true });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save channel');
    }
  };

  if (isEditMode && isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={300} height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={400} />
      </Box>
    );
  }

  if (isEditMode && isError) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>
          {/* A channel outside the caller's access answers as not found (D-310), so say both. */}
          {loadError instanceof Error && /not found/i.test(loadError.message)
            ? 'This channel was not found, or it is not in your access.'
            : `Failed to load channel: ${loadError instanceof Error ? loadError.message : 'Unknown error'}`}
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
      <PageHeader
        title={pageTitle}
        description={isEditMode
          ? 'Where this channel receives messages, how it transforms them and where it sends them.'
          : 'Name the channel, pick its source, then add at least one destination.'}
        meta={id !== undefined ? (
          <>
            <ChannelHealth channelId={id} />
            <Chip variant="outlined" size="small" label={enabledValue ? 'Enabled' : 'Disabled'} />
          </>
        ) : undefined}
        actions={
          <>
            {isEditMode ? (
              <Button size="small" startIcon={<HistoryIcon />} onClick={() => { setHistoryOpen(true); }}>
                History
              </Button>
            ) : null}
            <Tooltip title={canWrite ? '' : 'Requires channels:write permission'}>
              <span>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                  disabled={isSaving || (!isDirty && isEditMode) || !canWrite || (!isEditMode && needsGroup && newGroupId === '')}
                  onClick={handleSubmit(onSubmit)}
                >
                  {isEditMode ? 'Save' : 'Create'}
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

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

      <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Settings" />
        <Tab label="Source" />
        <Tab label="Destinations" />
        <Tab label="Scripts" />
        {isEditMode && canSeeAccess ? <Tab label="Access" /> : null}
      </Tabs>

      <ScriptDataTypeContext.Provider value={inboundDataType}>
      <ScriptTestSampleContext.Provider value={testSample}>
      <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
        <TabPanel value={activeTab} index={0}>
          {!isEditMode && <Box sx={{ mb: 2, maxWidth: 480 }}><NewChannelGroupField value={newGroupId} onChange={setNewGroupId} /></Box>}
          <SummaryTab
            control={control}
            errors={errors}
            isEditMode={isEditMode}
            channelId={id}
            revision={channel?.revision}
            advancedValues={advanced}
            onAdvancedChange={handleAdvancedChange}
          />
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
        {isEditMode && canSeeAccess && id ? (
          <TabPanel value={activeTab} index={4}>
            <AccessTab channelId={id} channelName={channel?.name ?? id} />
          </TabPanel>
        ) : null}
      </Paper>
      </ScriptTestSampleContext.Provider>
      </ScriptDataTypeContext.Provider>

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
