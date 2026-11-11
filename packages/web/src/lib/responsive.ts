// ===========================================
// Responsive helpers
// ===========================================

/**
 * `sx` for a table cell that only matters on wide screens. On phones (under the
 * `sm` breakpoint) the cell is hidden, so a list keeps its name, status and row
 * actions inside the screen instead of scrolling sideways. Put it on the header
 * cell and the body cell of the same column.
 */
export const HIDE_ON_PHONE = { display: { xs: 'none', sm: 'table-cell' } } as const;
