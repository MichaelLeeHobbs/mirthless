import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { JumpToButton, shortcutLabel } from '../JumpToButton.js';

afterEach(() => { cleanup(); });

describe('shortcutLabel', () => {
  it('shows the Command key on Apple platforms and Ctrl elsewhere', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘K');
    expect(shortcutLabel('iPhone')).toBe('⌘K');
    expect(shortcutLabel('Win32')).toBe('Ctrl K');
    expect(shortcutLabel('')).toBe('Ctrl K');
  });
});

describe('JumpToButton', () => {
  it('opens the palette from the search-box button on a desktop', () => {
    const onClick = vi.fn();
    render(<ThemeProvider theme={lightTheme}><JumpToButton compact={false} onClick={onClick} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Jump to a page or action/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('is an icon button on a phone', () => {
    const onClick = vi.fn();
    render(<ThemeProvider theme={lightTheme}><JumpToButton compact onClick={onClick} /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to' }));
    expect(onClick).toHaveBeenCalled();
  });
});
