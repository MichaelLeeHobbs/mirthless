// ===========================================
// Templates Section Tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { ALERT_TEMPLATE_VARIABLES } from '@galvaniflow/core-models';
import { darkTheme } from '../../../styles/theme.js';
import { TemplatesSection, findUnknownVariables, type TemplateFormValues } from '../TemplatesSection.js';

const EMPTY: TemplateFormValues = { subjectTemplate: '', bodyTemplate: '', reAlertIntervalMs: null, maxAlerts: null };

afterEach(() => { cleanup(); });

function renderSection(values: TemplateFormValues): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<ThemeProvider theme={darkTheme}><TemplatesSection values={values} onChange={onChange} /></ThemeProvider>);
  return onChange;
}

describe('findUnknownVariables', () => {
  it('accepts every listed variable', () => {
    const all = ALERT_TEMPLATE_VARIABLES.map((v) => '${' + v.name + '}').join(' ');
    expect(findUnknownVariables(all)).toEqual([]);
  });

  it('reports each unknown placeholder once', () => {
    expect(findUnknownVariables('${error} on ${channelName}: ${error} ${}')).toEqual(['error', '']);
  });
});

describe('TemplatesSection', () => {
  it('shows a chip for every variable the engine substitutes', () => {
    renderSection(EMPTY);
    for (const v of ALERT_TEMPLATE_VARIABLES) {
      expect(screen.getByText('${' + v.name + '}')).toBeTruthy();
    }
  });

  it('inserts into the body by default', () => {
    const onChange = renderSection({ ...EMPTY, bodyTemplate: 'Error: ' });
    fireEvent.click(screen.getByText('${errorMessage}'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, bodyTemplate: 'Error: ${errorMessage}' });
  });

  it('inserts at the caret of the field last focused', () => {
    const onChange = renderSection({ ...EMPTY, subjectTemplate: 'Error in now' });
    const subject = screen.getByLabelText('Subject Template') as HTMLInputElement;
    fireEvent.focus(subject);
    subject.setSelectionRange(9, 9);
    fireEvent.click(screen.getByText('${channelName}'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, subjectTemplate: 'Error in ${channelName}now' });
  });

  it('warns about placeholders that will not be substituted', () => {
    renderSection({ ...EMPTY, bodyTemplate: 'A channel error occurred: ${error}' });
    expect(screen.getByText('Not a variable, will be sent as written: ${error}')).toBeTruthy();
  });
});
