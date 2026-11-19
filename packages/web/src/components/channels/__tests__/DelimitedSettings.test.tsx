import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { SourceTransformerSection } from '../source/SourceTransformerSection.js';
import { unescapeControlChars } from '@galvanigraph/core-util';
import { showEscapes, readColumnNames, delimitedProblem } from '../source/DelimitedSettings.js';
import type { TransformerFormValues } from '../source/types.js';

let last: TransformerFormValues | undefined;

function Harness({ initial }: { initial: TransformerFormValues }): ReactElement {
  const [t, setT] = useState(initial);
  last = t;
  return <SourceTransformerSection transformer={t} onChange={(next) => { setT(next); last = next; }} />;
}

function renderSection(inboundDataType: string, inboundProperties: Record<string, unknown> = {}): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <Harness initial={{
        inboundDataType, outboundDataType: 'HL7V2', steps: [], inboundTemplate: null, outboundTemplate: null,
        inboundProperties: { serializationProperties: { kept: true }, ...inboundProperties }, outboundProperties: {},
      }} />
    </ThemeProvider>,
  );
}

function type(label: string, text: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

function delimited(): Record<string, unknown> {
  return (last?.inboundProperties['delimited'] ?? {}) as Record<string, unknown>;
}

afterEach(() => { cleanup(); last = undefined; });

describe('Delimited settings helpers', () => {
  it('shows control characters as escapes and reads them back', () => {
    expect(showEscapes('\t')).toBe('\\t');
    expect(showEscapes('\r\n')).toBe('\\r\\n');
    expect(unescapeControlChars('\\r\\n')).toBe('\r\n');
    expect(unescapeControlChars(showEscapes('a\\b\t'))).toBe('a\\b\t');
  });

  it('reads comma-separated column names, ignoring blanks', () => {
    expect(readColumnNames(' mrn, family ,,given, ')).toEqual(['mrn', 'family', 'given']);
  });

  it('reports what the server would refuse at deploy', () => {
    expect(delimitedProblem({})).toBeUndefined();
    expect(delimitedProblem({ columnNames: ['a', 'a'] })).toBe('Column names must be unique');
  });
});

describe('Source transformer Delimited settings', () => {
  it('appear only for a Delimited source', () => {
    renderSection('HL7V2');
    expect(screen.queryByText('Delimited settings')).toBeNull();
    cleanup();
    renderSection('DELIMITED');
    expect(screen.getByText('Delimited settings')).toBeTruthy();
  });

  it('save typed settings under inboundProperties.delimited, keeping the rest', () => {
    renderSection('DELIMITED');
    type('Column delimiter', '\\t');
    type('Column names', 'mrn, family,');
    fireEvent.click(screen.getByLabelText(/written twice/));
    type('Quote escape', '^');

    expect(delimited()).toEqual({ columnDelimiter: '\t', columnNames: ['mrn', 'family'], escapeWithDoubleQuote: false, quoteEscape: '^' });
    expect(last?.inboundProperties['serializationProperties']).toEqual({ kept: true });
    // The half-typed trailing comma stays in the field.
    expect((screen.getByLabelText('Column names') as HTMLInputElement).value).toBe('mrn, family,');
  });

  it('show saved settings, and warn when the channel would not deploy', () => {
    renderSection('DELIMITED', { delimited: { columnDelimiter: '|', columnNames: ['a', 'b'] } });
    expect((screen.getByLabelText('Column delimiter') as HTMLInputElement).value).toBe('|');
    expect(screen.queryByText(/will not deploy/)).toBeNull();

    type('Column names', 'a, a');
    expect(screen.getByText('The channel will not deploy: Column names must be unique')).toBeTruthy();
  });
});
