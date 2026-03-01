// ===========================================
// Destination Filter Section
// ===========================================
// Reuses FilterRuleEditor from source. Scoped to a single destination's filter.

import { useCallback, type ReactNode } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import type { FilterFormValues, FilterRuleFormValues } from '../source/types.js';
import { createDefaultFilterRule } from '../source/types.js';
import { FilterRuleEditor } from '../source/FilterRuleEditor.js';

interface DestinationFilterSectionProps {
  readonly filter: FilterFormValues;
  readonly onChange: (filter: FilterFormValues) => void;
}

export function DestinationFilterSection({ filter, onChange }: DestinationFilterSectionProps): ReactNode {
  const handleAdd = useCallback((): void => {
    onChange({ rules: [...filter.rules, createDefaultFilterRule()] });
  }, [filter, onChange]);

  const handleRuleChange = useCallback((index: number, updates: Partial<FilterRuleFormValues>): void => {
    const updated = filter.rules.map((r, i) => (i === index ? { ...r, ...updates } : r));
    onChange({ rules: updated });
  }, [filter, onChange]);

  const handleRemove = useCallback((index: number): void => {
    onChange({ rules: filter.rules.filter((_, i) => i !== index) });
  }, [filter, onChange]);

  const handleMoveUp = useCallback((index: number): void => {
    if (index <= 0) return;
    const updated = [...filter.rules];
    const temp = updated[index - 1]!;
    updated[index - 1] = updated[index]!;
    updated[index] = temp;
    onChange({ rules: updated });
  }, [filter, onChange]);

  const handleMoveDown = useCallback((index: number): void => {
    if (index >= filter.rules.length - 1) return;
    const updated = [...filter.rules];
    const temp = updated[index + 1]!;
    updated[index + 1] = updated[index]!;
    updated[index] = temp;
    onChange({ rules: updated });
  }, [filter, onChange]);

  return (
    <Accordion disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography sx={{ fontWeight: 600, mr: 2 }}>Destination Filter</Typography>
        <Typography variant="body2" color="text.secondary">
          {filter.rules.length === 0
            ? 'No filter rules — all messages pass through'
            : `${String(filter.rules.length)} rule${filter.rules.length === 1 ? '' : 's'}`}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        {filter.rules.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No filter rules. All messages will pass through.
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            {filter.rules.map((rule, index) => (
              <FilterRuleEditor
                key={index}
                rule={rule}
                index={index}
                total={filter.rules.length}
                onChange={(updates) => { handleRuleChange(index, updates); }}
                onRemove={() => { handleRemove(index); }}
                onMoveUp={() => { handleMoveUp(index); }}
                onMoveDown={() => { handleMoveDown(index); }}
              />
            ))}
          </Box>
        )}
        <Button startIcon={<AddIcon />} onClick={handleAdd} size="small">
          Add Rule
        </Button>
      </AccordionDetails>
    </Accordion>
  );
}
