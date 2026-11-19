import { type ReactNode, type ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { ScriptEditor } from '../../editors/ScriptEditor.js';
import { ItemOrderActions } from './ItemOrderActions.js';
import { ItemCard } from './ItemCard.js';
import { FILTER_TRANSFORMER_SURFACE, type ScriptStage } from '../../editors/script-context.js';
import type { FilterRuleFormValues } from './types.js';

interface FilterRuleEditorProps {
  readonly rule: FilterRuleFormValues;
  readonly index: number;
  readonly total: number;
  readonly onChange: (updates: Partial<FilterRuleFormValues>) => void;
  readonly onRemove: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  /** Source rules can choose destinations; the stage also picks the code templates offered. */
  readonly stage?: ScriptStage;
}

export function FilterRuleEditor({
  stage = 'source',
  rule,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FilterRuleEditorProps): ReactNode {
  const title = rule.name || `Rule ${String(index + 1)}`;

  const summary = (
    <>
      {rule.type === 'JAVASCRIPT' ? `Script · ${rule.language === 'TYPESCRIPT' ? 'TypeScript' : 'JavaScript'}` : 'Rule Builder'}
      {!rule.enabled ? <Box component="span" sx={{ color: 'warning.main', ml: 1 }}>Disabled</Box> : null}
    </>
  );
  const settings = (
        <>
          <TextField
            label="Name"
            value={rule.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ name: e.target.value }); }}
            size="small"
            sx={{ flexGrow: 1, minWidth: 200 }}
          />
          <TextField
            label="Type"
            value={rule.type}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onChange({ type: e.target.value as FilterRuleFormValues['type'] });
            }}
            select
            size="small"
            sx={{ minWidth: 150 }}
          >
            {/* JAVASCRIPT is the stored name for any script rule, JavaScript or TypeScript. */}
            <MenuItem value="JAVASCRIPT">Script</MenuItem>
            <MenuItem value="RULE_BUILDER">Rule Builder</MenuItem>
          </TextField>
          <TextField
            label="Operator"
            value={rule.operator}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onChange({ operator: e.target.value as FilterRuleFormValues['operator'] });
            }}
            select
            size="small"
            sx={{ minWidth: 100 }}
          >
            <MenuItem value="AND">AND</MenuItem>
            <MenuItem value="OR">OR</MenuItem>
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={rule.enabled}
                onChange={(_e, checked) => { onChange({ enabled: checked }); }}
                size="small"
              />
            }
            label="Enabled"
          />
          <ItemOrderActions noun="rule" index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
        </>
  );

  return (
    <ItemCard title={title} summary={summary} settings={settings}>

        {rule.type === 'JAVASCRIPT' ? (
          <ScriptEditor
            height="auto"
            showLabel={false}
            label={`${rule.name || 'Rule'} script`}
            surface={FILTER_TRANSFORMER_SURFACE[stage]}
            testKind="filter"
            language={rule.language}
            onLanguageChange={(language) => { onChange({ language }); }}
            value={rule.script}
            onChange={(value) => { onChange({ script: value ?? '' }); }}
            showLanguageToggle
          />
        ) : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Field"
              value={rule.field}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ field: e.target.value }); }}
              size="small"
              placeholder="e.g. MSH.9.1"
              sx={{ minWidth: 200 }}
            />
            <TextField
              label="Condition"
              value={rule.condition}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ condition: e.target.value }); }}
              select
              size="small"
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="EQUALS">Equals</MenuItem>
              <MenuItem value="NOT_EQUALS">Not Equals</MenuItem>
              <MenuItem value="CONTAINS">Contains</MenuItem>
              <MenuItem value="NOT_CONTAINS">Not Contains</MenuItem>
              <MenuItem value="EXISTS">Exists</MenuItem>
              <MenuItem value="NOT_EXISTS">Not Exists</MenuItem>
              <MenuItem value="STARTS_WITH">Starts With</MenuItem>
              <MenuItem value="ENDS_WITH">Ends With</MenuItem>
              <MenuItem value="REGEX">Regex</MenuItem>
            </TextField>
            <TextField
              label="Values (comma-separated)"
              value={rule.values.join(', ')}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const vals = e.target.value.split(',').map((v) => v.trim()).filter(Boolean);
                onChange({ values: vals });
              }}
              size="small"
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
          </Box>
        )}
    </ItemCard>
  );
}
