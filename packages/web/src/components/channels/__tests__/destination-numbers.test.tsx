// Queued messages and destinationSet know a destination by its number, so the list says it (D-348).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createDefaultDestination } from '../destinations/connector-defaults.js';
import { DestinationListPanel } from '../destinations/DestinationListPanel.js';

afterEach(() => { cleanup(); });

const nothing = (): void => undefined;

describe('DestinationListPanel', () => {
  it('says the number of a saved destination, and none for one that is not saved', () => {
    const saved = { ...createDefaultDestination([]), name: 'Lab', metaDataId: 7 };
    const added = createDefaultDestination([saved]);
    render(<DestinationListPanel
      destinations={[saved, added]} selectedIndex={0} onSelect={nothing} onAdd={nothing} onRemove={nothing} onMoveUp={nothing} onMoveDown={nothing}
    />);
    expect(screen.getAllByRole('button', { name: /TCP\/MLLP/ }).map((b) => b.textContent)).toEqual(['LabTCP/MLLP#7', 'Destination 2TCP/MLLP']);
  });
});
