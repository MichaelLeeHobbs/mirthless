// ===========================================
// Wordmark Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { darkTheme, lightTheme } from '../../../styles/theme.js';
import { Wordmark } from '../Wordmark.js';

function renderHeading(theme: Theme): HTMLElement {
  render(<ThemeProvider theme={theme}><h1 style={{ color: 'black' }}><Wordmark /></h1></ThemeProvider>);
  return screen.getByRole('heading');
}

/** Colour of each letter, read from the innermost element holding it. */
function letterColours(heading: HTMLElement): string[] {
  const colours: string[] = [];
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const colour = getComputedStyle(node.parentElement!).color;
    for (let i = 0; i < (node.textContent ?? '').length; i++) colours.push(colour);
  }
  return colours;
}

describe('Wordmark', () => {
  afterEach(() => { cleanup(); });

  it('reads as one word to assistive tech', () => {
    expect(renderHeading(darkTheme)).toHaveProperty('textContent', 'GalvaniGraph');
    expect(screen.getByRole('heading', { name: 'GalvaniGraph' })).toBeTruthy();
  });

  it.each([['dark', darkTheme], ['light', lightTheme]] as const)(
    'colours both G\'s, and only them, with the %s theme accent',
    (_mode, theme) => {
      const colours = letterColours(renderHeading(theme));
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = theme.palette.primary.main;
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const accented = colours.flatMap((c, i) => (c === accent ? [i] : []));
      expect(accented).toEqual([0, 7]); // G-alvani-G-raph
    },
  );
});
