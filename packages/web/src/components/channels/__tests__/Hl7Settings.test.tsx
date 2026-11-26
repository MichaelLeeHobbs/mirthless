import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { SourceTransformerSection } from '../source/SourceTransformerSection.js';
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

const SWITCH = /writes hex escapes as Unicode code points/;

afterEach(() => { cleanup(); last = undefined; });

describe('Source transformer HL7 v2 settings (#194)', () => {
  it('appear only for an HL7 v2 source', () => {
    renderSection('DELIMITED');
    expect(screen.queryByText('HL7 v2 settings')).toBeNull();
    cleanup();
    renderSection('HL7V2');
    expect(screen.getByText('HL7 v2 settings')).toBeTruthy();
  });

  it('read hex escapes as bytes until the switch is turned on, and save it under inboundProperties.hl7, keeping the rest', () => {
    renderSection('HL7V2');
    const toggle = screen.getByLabelText(SWITCH) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(last?.inboundProperties['hl7']).toEqual({ hexCodePoints: true });
    expect(last?.inboundProperties['serializationProperties']).toEqual({ kept: true });
    fireEvent.click(toggle);
    expect(last?.inboundProperties['hl7']).toEqual({ hexCodePoints: false });
  });

  it('show the saved setting, and warn when the channel would not deploy', () => {
    renderSection('HL7V2', { hl7: { hexCodePoints: true } });
    expect((screen.getByLabelText(SWITCH) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/will not deploy/)).toBeNull();
    cleanup();
    renderSection('HL7V2', { hl7: { hexCodePoints: 'yes' } });
    expect(screen.getByText(/^The channel will not deploy: /)).toBeTruthy();
  });
});
