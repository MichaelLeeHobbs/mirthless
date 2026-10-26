import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { TAG_COLOR } from '../../../styles/tokens.js';
import { TagChips, contrastText } from '../TagChips.js';
import type { TagSummary } from '../../../hooks/use-tags.js';

function tag(id: string, name: string, color: string | null): TagSummary {
  return { id, name, color, assignmentCount: 0 };
}

afterEach(() => { cleanup(); });

describe('contrastText', () => {
  it('returns dark text over a light background and white over a dark one', () => {
    expect(contrastText('#ffffff')).toBe(TAG_COLOR.textOnLight);
    expect(contrastText('#000000')).toBe(TAG_COLOR.textOnDark);
    expect(contrastText('#f0e68c')).toBe(TAG_COLOR.textOnLight); // khaki (light)
    expect(contrastText('#1a237e')).toBe(TAG_COLOR.textOnDark); // indigo (dark)
  });

  it('returns undefined for null/invalid colors', () => {
    expect(contrastText(null)).toBeUndefined();
    expect(contrastText('not-a-color')).toBeUndefined();
  });
});

describe('TagChips', () => {
  it('renders nothing for no tags', () => {
    const { container } = render(<ThemeProvider theme={darkTheme}><TagChips tags={[]} /></ThemeProvider>);
    expect(container.textContent).toBe('');
  });

  it('renders each tag and collapses overflow into +N', () => {
    const tags = [
      tag('1', 'prod', '#ff0000'),
      tag('2', 'hl7', '#00ff00'),
      tag('3', 'lab', '#0000ff'),
      tag('4', 'urgent', '#ffff00'),
      tag('5', 'extra', '#00ffff'),
      tag('6', 'more', '#ff00ff'),
    ];
    render(<ThemeProvider theme={darkTheme}><TagChips tags={tags} max={4} /></ThemeProvider>);
    expect(screen.getByText('prod')).toBeTruthy();
    expect(screen.getByText('urgent')).toBeTruthy();
    expect(screen.queryByText('extra')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });
});
