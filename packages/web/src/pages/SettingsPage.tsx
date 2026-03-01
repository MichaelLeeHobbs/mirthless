// ===========================================
// Settings Page
// ===========================================
// System settings management with category tabs and type-aware inputs.

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import SaveIcon from '@mui/icons-material/Save';
import { useSettings, useBulkUpsertSettings } from '../hooks/use-settings.js';
import type { SettingDetail } from '../api/client.js';

const CATEGORIES = ['all', 'general', 'security', 'features'] as const;

interface EditableValue {
  readonly value: string;
  readonly dirty: boolean;
}

export function SettingsPage(): ReactNode {
  const [activeTab, setActiveTab] = useState(0);
  const { data: settings, isLoading, error, isFetching } = useSettings();
  const bulkUpsert = useBulkUpsertSettings();

  const [editValues, setEditValues] = useState<Record<string, EditableValue>>({});

  const initEditValues = useCallback((data: readonly SettingDetail[]): void => {
    const values: Record<string, EditableValue> = {};
    for (const setting of data) {
      values[setting.key] = { value: setting.value ?? '', dirty: false };
    }
    setEditValues(values);
  }, []);

  useEffect(() => {
    if (settings) {
      initEditValues(settings);
    }
  }, [settings, initEditValues]);

  const handleValueChange = (key: string, value: string): void => {
    setEditValues((prev) => ({
      ...prev,
      [key]: { value, dirty: true },
    }));
  };

  const handleBooleanToggle = (key: string, checked: boolean): void => {
    handleValueChange(key, checked ? 'true' : 'false');
  };

  const dirtySettings = Object.entries(editValues)
    .filter(([, v]) => v.dirty)
    .map(([key]) => key);

  const hasDirtySettings = dirtySettings.length > 0;

  const handleSave = (): void => {
    if (!settings) return;

    const toSave = settings
      .filter((s) => dirtySettings.includes(s.key))
      .map((s) => ({
        key: s.key,
        value: editValues[s.key]?.value ?? s.value ?? '',
        type: s.type as 'string' | 'number' | 'boolean' | 'json',
        description: s.description ?? null,
        category: s.category ?? 'general',
      }));

    if (toSave.length === 0) return;

    bulkUpsert.mutate({ settings: toSave });
  };

  const selectedCategory = CATEGORIES[activeTab] ?? 'all';

  const filteredSettings = settings?.filter((s) =>
    selectedCategory === 'all' || s.category === selectedCategory,
  ) ?? [];

  const renderSettingInput = (setting: SettingDetail): ReactNode => {
    const editValue = editValues[setting.key];
    const currentValue = editValue?.value ?? setting.value ?? '';

    if (setting.type === 'boolean') {
      return (
        <FormControlLabel
          control={
            <Switch
              checked={currentValue === 'true'}
              onChange={(_e, checked) => { handleBooleanToggle(setting.key, checked); }}
            />
          }
          label={currentValue === 'true' ? 'Enabled' : 'Disabled'}
        />
      );
    }

    if (setting.type === 'number') {
      return (
        <TextField
          size="small"
          type="number"
          fullWidth
          value={currentValue}
          onChange={(e) => { handleValueChange(setting.key, e.target.value); }}
        />
      );
    }

    if (setting.type === 'json') {
      return (
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={3}
          maxRows={8}
          value={currentValue}
          onChange={(e) => { handleValueChange(setting.key, e.target.value); }}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.85rem' } } }}
        />
      );
    }

    // Default: string
    return (
      <TextField
        size="small"
        fullWidth
        value={currentValue}
        onChange={(e) => { handleValueChange(setting.key, e.target.value); }}
      />
    );
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>Settings</Typography>
          {isFetching && !isLoading && <CircularProgress size={20} />}
        </Box>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={!hasDirtySettings || bulkUpsert.isPending}
          onClick={handleSave}
        >
          {bulkUpsert.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </Box>

      {/* Error */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load settings: {error.message}</Alert>}
      {bulkUpsert.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>Settings saved successfully.</Alert>}

      {/* Loading */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper>
          {/* Category Tabs */}
          <Tabs
            value={activeTab}
            onChange={(_e, v: number) => { setActiveTab(v); }}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            {CATEGORIES.map((cat) => (
              <Tab key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)} />
            ))}
          </Tabs>

          {/* Settings List */}
          <Box sx={{ p: 3 }}>
            {filteredSettings.length > 0 ? (
              filteredSettings.map((setting) => (
                <Box key={setting.key} sx={{ mb: 3, pb: 2, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0, mb: 0, pb: 0 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontFamily: 'monospace' }}>
                      {setting.key}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      ({setting.type})
                    </Typography>
                  </Box>
                  {setting.description ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {setting.description}
                    </Typography>
                  ) : null}
                  {renderSettingInput(setting)}
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No settings in this category
              </Typography>
            )}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
