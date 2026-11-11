// ===========================================
// Transformer Step Editor Tests
// ===========================================
// The engine cannot run Mapper steps and refuses to deploy a channel that has an
// enabled one, so the editor must say so instead of letting the step look valid.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { TransformerStepEditor } from '../source/TransformerStepEditor.js';
import type { TransformerStepFormValues } from '../source/types.js';

afterEach(() => { cleanup(); });

function mapperStep(overrides: Partial<TransformerStepFormValues> = {}): TransformerStepFormValues {
  return {
    enabled: true, name: 'Copy MRN', type: 'MAPPER', script: '',
    sourceField: 'msg.mrn', targetField: 'tmp.mrn', defaultValue: '', mapping: 'COPY',
    ...overrides,
  } as TransformerStepFormValues;
}

function renderStep(step: TransformerStepFormValues): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <TransformerStepEditor
        step={step} index={0} total={1}
        onChange={vi.fn()} onRemove={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe('TransformerStepEditor', () => {
  it('warns that an enabled Mapper step blocks deployment', () => {
    renderStep(mapperStep());
    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('will not deploy while this step is enabled');
  });

  it('does not warn about a disabled Mapper step, which the engine skips', () => {
    renderStep(mapperStep({ enabled: false }));
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  });
});
