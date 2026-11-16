// ===========================================
// Wordmark
// ===========================================
// The product name with both G's in the accent colour, so it reads as "GG",
// as in assets/wordmark-*.svg (D-309). Renders inline text only: the caller's
// Typography sets the size, weight and the colour of the other letters.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

function AccentG(): ReactNode {
  return <Box component="span" sx={{ color: 'primary.main' }}>G</Box>;
}

/** "GalvaniGraph" with the two G's in `primary.main`. */
export function Wordmark(): ReactNode {
  return <><AccentG />alvani<AccentG />raph</>;
}
