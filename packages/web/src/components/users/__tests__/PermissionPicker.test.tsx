import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { PermissionPicker } from '../PermissionPicker.js';

afterEach(cleanup);

function box(label: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }) as HTMLInputElement;
}

function renderPicker(selected: string[], held: string[], original: string[], readOnly = false): void {
  render(
    <ThemeProvider theme={lightTheme}>
      <PermissionPicker selected={new Set(selected)} held={new Set(held)} original={new Set(original)} readOnly={readOnly} onToggle={vi.fn()} />
    </ThemeProvider>,
  );
}

describe('PermissionPicker', () => {
  it('blocks adding a permission the editor does not hold, and says why', () => {
    renderPicker([], ['channels:read'], []);
    expect(box('Read channels').disabled).toBe(false);
    expect(box('Change users').disabled).toBe(true);
    expect(box('Change users').closest('label')?.textContent).toContain('You can add only permissions you hold yourself.');
  });

  it('lets the editor remove a permission they lack, and put it back if the role had it', () => {
    renderPicker(['users:write'], [], ['users:write']);
    expect(box('Change users').checked).toBe(true);
    expect(box('Change users').disabled).toBe(false);
    cleanup();
    renderPicker([], [], ['users:write']);
    expect(box('Change users').disabled).toBe(false);
  });

  it('disables every box when the role is read-only', () => {
    renderPicker(['channels:read'], ['channels:read'], ['channels:read'], true);
    expect(box('Read channels').disabled).toBe(true);
  });
});
