import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { ConfirmDialog, isValidReason } from '../ConfirmDialog.js';

afterEach(() => { cleanup(); });

function show(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}): { onConfirm: ReturnType<typeof vi.fn> } {
  const onConfirm = vi.fn();
  render(
    <ThemeProvider theme={lightTheme}>
      <ConfirmDialog open title="Export" message="Sure?" confirmLabel="Export" onConfirm={onConfirm} onCancel={vi.fn()} {...props} />
    </ThemeProvider>,
  );
  return { onConfirm };
}

const confirmButton = (): HTMLElement => screen.getByRole('button', { name: 'Export' });
const disabled = (): boolean => (confirmButton() as HTMLButtonElement).disabled;

describe('ConfirmDialog', () => {
  it('confirms at once with no reason asked', () => {
    const { onConfirm } = show();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('waits for a reason of at least three characters, then passes it trimmed', () => {
    const { onConfirm } = show({ reasonLabel: 'Reason for this export' });
    expect(disabled()).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason for this export/), { target: { value: ' ab ' } });
    expect(disabled()).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for this export/), { target: { value: '  Quarterly review ' } });
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith('Quarterly review');
  });

  it('waits for the exact text when one must be typed', () => {
    const { onConfirm } = show({ requireTyped: 'DELETE' });
    expect(disabled()).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } });
    expect(disabled()).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('isValidReason', () => {
  it('accepts 3 to 500 characters on one line, as the server does', () => {
    expect(isValidReason('abc')).toBe(true);
    expect(isValidReason('  ab ')).toBe(false);
    expect(isValidReason('a'.repeat(501))).toBe(false);
    expect(isValidReason('one\ntwo')).toBe(false);
  });
});
