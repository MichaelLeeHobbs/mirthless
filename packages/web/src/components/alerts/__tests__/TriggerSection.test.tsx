// ===========================================
// Trigger Section Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { TriggerSection, buildTriggerPayload, type TriggerFormValues } from '../TriggerSection.js';

const ERRORS: TriggerFormValues = { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: '', windowMinutes: 60 };

afterEach(() => { cleanup(); });

function renderSection(values: TriggerFormValues): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<ThemeProvider theme={darkTheme}><TriggerSection values={values} onChange={onChange} /></ThemeProvider>);
  return onChange;
}

describe('buildTriggerPayload', () => {
  it('builds a CHANNEL_ERROR trigger with a null regex when blank', () => {
    expect(buildTriggerPayload(ERRORS)).toEqual({ type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null });
  });

  it('builds a NO_MESSAGES trigger with only the window', () => {
    expect(buildTriggerPayload({ ...ERRORS, type: 'NO_MESSAGES', windowMinutes: 15 }))
      .toEqual({ type: 'NO_MESSAGES', windowMinutes: 15 });
  });

  it('drops error types the API does not know', () => {
    expect(buildTriggerPayload({ ...ERRORS, errorTypes: ['ANY', 'BOGUS'] }))
      .toEqual({ type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null });
  });
});

describe('TriggerSection', () => {
  it('shows error filters for a CHANNEL_ERROR trigger', () => {
    renderSection(ERRORS);
    expect(screen.getByLabelText('Regex Filter (optional)')).toBeTruthy();
    expect(screen.queryByLabelText('Minutes without a message')).toBeNull();
  });

  it('shows the window field for a NO_MESSAGES trigger and clamps it to at least 1', () => {
    const onChange = renderSection({ ...ERRORS, type: 'NO_MESSAGES' });
    expect(screen.queryByLabelText('Regex Filter (optional)')).toBeNull();

    fireEvent.change(screen.getByLabelText('Minutes without a message'), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ windowMinutes: 1 }));
  });

  it('switches the trigger type from the selector', () => {
    const onChange = renderSection(ERRORS);
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('A started channel receives no messages'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'NO_MESSAGES' }));
  });
});
