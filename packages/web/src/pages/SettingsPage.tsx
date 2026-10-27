// ===========================================
// Settings Page
// ===========================================
// System settings on one page, in sections from lib/settings-catalog.ts: each
// row says what the setting does, with its control beside it. Changes collect
// in a bar at the bottom (Discard / Save, or Ctrl+S) that only shows while
// something changed. Pruner settings save through the pruner schedule API so
// the new schedule takes effect at once.

import { useBeforeUnload } from '../hooks/use-beforeunload.js';
import { useState, useEffect, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import TuneIcon from '@mui/icons-material/Tune';
import { useSettings, useBulkUpsertSettings } from '../hooks/use-settings.js';
import { useUpdatePrunerSchedule } from '../hooks/use-pruner.js';
import { usePermissions } from '../hooks/use-permissions.js';
import { useNotification } from '../stores/notification.store.js';
import { PERMISSION } from '../lib/permissions.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { UnsavedChangesBar } from '../components/common/UnsavedChangesBar.js';
import { SettingInput } from '../components/settings/SettingInput.js';
import { EmptyState } from '../components/common/states/EmptyState.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';
import type { SettingDetail } from '../api/client.js';
import { FONT_FAMILY_MONO } from '../styles/tokens.js';
import { fieldFor, groupSettings, isSecret, validateSetting, PRUNER_KEYS, REDACTED, type GroupedSection } from '../lib/settings-catalog.js';

type SettingType = 'string' | 'number' | 'boolean' | 'json' | 'password';

/** The value a setting's control starts from. A secret starts empty: its stored value never reaches the browser. */
function savedValue(s: SettingDetail): string {
  return isSecret(s.key, s.type) ? '' : (s.value ?? '');
}

interface RowProps {
  readonly setting: SettingDetail;
  readonly value: string;
  readonly edited: boolean;
  readonly error: string | null;
  readonly canWrite: boolean;
  readonly onChange: (key: string, value: string) => void;
}

function SettingRow({ setting, value, edited, error, canWrite, onChange }: RowProps): ReactNode {
  const field = fieldFor(setting.key);
  const id = `setting-${setting.key}`;
  const help = field.help || setting.description || '';
  const secret = isSecret(setting.key, setting.type);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1.1fr)' },
        gap: { xs: 1, md: 3 },
        alignItems: 'start',
        px: { xs: 2, md: 3 },
        py: 2,
        '& + &': { borderTop: 1, borderColor: 'divider' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="subtitle2" component="label" htmlFor={id}>{field.label}</Typography>
          {edited ? <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>Edited</Typography> : null}
        </Box>
        {help ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>{help}</Typography> : null}
        <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: FONT_FAMILY_MONO, display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
          {setting.key}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', justifyContent: setting.type === 'boolean' ? { xs: 'flex-start', md: 'flex-end' } : 'stretch' }}>
        <SettingInput
          id={id}
          label={field.label}
          type={setting.type}
          value={value}
          disabled={!canWrite}
          error={error}
          {...(secret ? { secretStored: setting.value === REDACTED } : {})}
          {...(field.placeholder ? { placeholder: field.placeholder } : {})}
          onChange={(v) => { onChange(setting.key, v); }}
        />
      </Box>
    </Box>
  );
}

interface SectionProps extends Omit<RowProps, 'setting' | 'value' | 'edited' | 'error'> {
  readonly group: GroupedSection<SettingDetail>;
  readonly valueOf: (s: SettingDetail) => string;
  readonly isEdited: (s: SettingDetail) => boolean;
  readonly errorOf: (s: SettingDetail) => string | null;
}

function SettingsSection({ group, valueOf, isEdited, errorOf, canWrite, onChange }: SectionProps): ReactNode {
  const { section, settings } = group;
  return (
    <Paper component="section" id={`settings-${section.id}`} aria-labelledby={`settings-${section.id}-title`} sx={{ mb: 2, scrollMarginTop: 80 }}>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" component="h2" id={`settings-${section.id}-title`}>{section.label}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{section.intro}</Typography>
      </Box>
      {settings.map((s) => (
        <SettingRow key={s.key} setting={s} value={valueOf(s)} edited={isEdited(s)} error={errorOf(s)} canWrite={canWrite} onChange={onChange} />
      ))}
    </Paper>
  );
}

export function SettingsPage(): ReactNode {
  const { data: settings, isLoading, error, isFetching, refetch } = useSettings();
  const bulkUpsert = useBulkUpsertSettings();
  const updateSchedule = useUpdatePrunerSchedule();
  const { has } = usePermissions();
  const { notify } = useNotification();
  const canWrite = has(PERMISSION.SETTINGS_WRITE);

  // Only the values someone changed, by key.
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  const all = settings ?? [];
  const valueOf = (s: SettingDetail): string => edits[s.key] ?? savedValue(s);
  const isEdited = (s: SettingDetail): boolean => s.key in edits && edits[s.key] !== savedValue(s);
  const errorOf = (s: SettingDetail): string | null => (isEdited(s) ? validateSetting(s.type, valueOf(s), fieldFor(s.key).check) : null);

  const changed = all.filter(isEdited);
  const invalid = changed.filter((s) => errorOf(s) !== null);
  const dirty = changed.length > 0;

  useBeforeUnload(dirty);
  const blocker = useBlocker(dirty);

  const handleChange = (key: string, value: string): void => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const save = async (): Promise<void> => {
    if (!dirty || invalid.length > 0 || saving) return;
    setSaving(true);
    try {
      const plain = changed.filter((s) => s.key !== PRUNER_KEYS.enabled && s.key !== PRUNER_KEYS.cron);
      if (plain.length > 0) {
        await bulkUpsert.mutateAsync({
          settings: plain.map((s) => ({
            key: s.key,
            value: valueOf(s),
            type: s.type as SettingType,
            description: s.description ?? null,
            category: s.category ?? 'general',
          })),
        });
      }
      if (plain.length < changed.length) {
        const enabled = all.find((s) => s.key === PRUNER_KEYS.enabled);
        const cron = all.find((s) => s.key === PRUNER_KEYS.cron);
        await updateSchedule.mutateAsync({
          enabled: enabled ? valueOf(enabled) === 'true' : false,
          cronExpression: cron ? valueOf(cron) : '0 3 * * *',
        });
        await refetch();
      }
      setEdits({});
      notify(changed.length === 1 ? 'Setting saved' : `${changed.length} settings saved`, 'success');
    } catch (e) {
      notify(`Not saved: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S / ⌘S saves while there is something to save.
  useEffect(() => {
    if (!dirty || !canWrite) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  });

  const blockedReason = invalid.length > 0
    ? `Fix ${invalid.length === 1 ? 'the highlighted value' : `${invalid.length} highlighted values`} to save`
    : null;

  return (
    <Box>
      <PageHeader
        title="Settings"
        description={canWrite
          ? 'Server-wide configuration. Change a value, then save from the bar at the bottom (or press Ctrl+S).'
          : 'Server-wide configuration. Read-only: changing settings needs the settings:write permission.'}
        isFetching={isFetching && !isLoading}
      />

      {error ? (
        <ErrorState title="Couldn't load settings" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      ) : null}

      {isLoading ? (
        <LoadingBlock label="Loading settings" />
      ) : settings && settings.length === 0 ? (
        <EmptyState icon={<TuneIcon />} title="No settings yet" description="The server seeds its settings on first start. Run the seed, then reload." />
      ) : (
        groupSettings(all).map((group) => (
          <SettingsSection
            key={group.section.id}
            group={group}
            valueOf={valueOf}
            isEdited={isEdited}
            errorOf={errorOf}
            canWrite={canWrite}
            onChange={handleChange}
          />
        ))
      )}

      {dirty && canWrite ? (
        <UnsavedChangesBar
          count={changed.length}
          saving={saving}
          blockedReason={blockedReason}
          onDiscard={() => { setEdits({}); }}
          onSave={() => void save()}
        />
      ) : null}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Unsaved Changes"
        message="You have unsaved settings. Leave anyway?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        severity="warning"
        onConfirm={() => { blocker.proceed?.(); }}
        onCancel={() => { blocker.reset?.(); }}
      />
    </Box>
  );
}
