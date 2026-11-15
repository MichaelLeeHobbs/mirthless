// A filter rule or transformer step card. Open, its settings take the header row
// itself, so the card spends one row on them instead of a title row plus a
// settings row.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../../styles/theme.js';
import { ItemCard } from '../source/ItemCard.js';

afterEach(() => { cleanup(); });

function renderCard(): void {
  render(
    <ThemeProvider theme={lightTheme}>
      <ItemCard
        title="Normalize MRN"
        summary="Script · TypeScript"
        settings={<input aria-label="Name" defaultValue="Normalize MRN" />}
      >
        <p>step body</p>
      </ItemCard>
    </ThemeProvider>,
  );
}

describe('ItemCard', () => {
  it('starts closed, showing the title and summary as a button that opens it', () => {
    renderCard();
    const open = screen.getByRole('button', { name: /Normalize MRN/ });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Script · TypeScript')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  });

  it('puts the settings in the header row when open, with no separate title row', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Normalize MRN/ }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.queryByText('Script · TypeScript')).toBeNull();
    expect(screen.getByText('step body')).toBeTruthy();
  });

  it('closes from its collapse button', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Normalize MRN/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Normalize MRN' }));
    expect(screen.getByRole('button', { name: /Normalize MRN/ }).getAttribute('aria-expanded')).toBe('false');
  });
});
