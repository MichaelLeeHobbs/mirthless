// Both G's in the accent colour, as in assets/wordmark-*.svg (D-309). Inline text only: the caller's Typography sets the size, weight and the other letters' colour.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

function AccentG(): ReactNode {
  return <Box component="span" sx={{ color: 'primary.main' }}>G</Box>;
}

export function Wordmark(): ReactNode {
  return <><AccentG />alvani<AccentG />raph</>;
}
