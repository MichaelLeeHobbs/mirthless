// ===========================================
// Filter Rule Editor
// ===========================================
// Shared component for editing a single filter rule.
// Used by both source and destination filter sections.

import { type ReactNode, type ChangeEvent } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { ScriptEditor } from '../../editors/ScriptEditor.js';
import type { FilterRuleFormValues } from './types.js';

interface FilterRuleEditorProps {
  readonly rule: FilterRuleFormValues;
  readonly index: number;
  readonly total: number;
  readonly onChange: (updates: Partial<FilterRuleFormValues>) => void;
  readonly onRemove: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
}

export function FilterRuleEditor({
  rule,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FilterRuleEditorProps): ReactNode {
  const title = rule.name || `Rule ${String(index + 1)}`;

  return (
    <Accordion disableGutters>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1 } }}
      >
        <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          {rule.type === 'JAVASCRIPT' ? 'JavaScript' : 'Rule Builder'}
        </Typography>
        {!rule.enabled ? (
          <Typography variant="caption" color="warning.main" sx={{ mr: 1 }}>
            Disabled
          </Typography>
        ) : null}
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
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
            <MenuItem value="JAVASCRIPT">JavaScript</MenuItem>
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
        </Box>

        {rule.type === 'JAVASCRIPT' ? (
          <ScriptEditor
            height="200px"
            value={rule.script}
            onChange={(value) => { onChange({ script: value ?? '' }); }}
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

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 0.5 }}>
          <IconButton size="small" onClick={onMoveUp} disabled={index === 0} title="Move up">
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onMoveDown} disabled={index === total - 1} title="Move down">
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onRemove} color="error" title="Remove rule">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
