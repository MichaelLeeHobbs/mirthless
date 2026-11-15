// ===========================================
// Database vendor control tests
// ===========================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { useState, type ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';

vi.mock('../../common/TestConnectionButton.js', () => ({ TestConnectionButton: () => null }));

import { DatabaseDestinationForm } from '../destinations/DatabaseDestinationForm.js';
import { DatabaseSourceForm } from '../source/DatabaseSourceForm.js';
import { withDatabaseVendor } from '../common/DatabaseVendorField.js';

let lastProps: Record<string, unknown> = {};

function Harness({ initial, source }: { initial: Record<string, unknown>; source: boolean }): ReactElement {
  const [props, setProps] = useState<Record<string, unknown>>(initial);
  lastProps = props;
  const onChange = (p: Record<string, unknown>): void => { setProps(p); lastProps = p; };
  return source ? <DatabaseSourceForm properties={props} onChange={onChange} /> : <DatabaseDestinationForm properties={props} onChange={onChange} />;
}

function renderForm(initial: Record<string, unknown>, source = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={darkTheme}><Harness initial={initial} source={source} /></ThemeProvider>
    </QueryClientProvider>,
  );
}

function chooseVendor(label: string): void {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Database type' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByText(label));
}

afterEach(() => { cleanup(); lastProps = {}; });

describe('withDatabaseVendor', () => {
  it('moves a default port to the new vendor and keeps a port someone typed', () => {
    expect(withDatabaseVendor({ port: 5432 }, 'mysql')).toEqual({ vendor: 'mysql', port: 3306 });
    expect(withDatabaseVendor({}, 'mysql')).toEqual({ vendor: 'mysql', port: 3306 });
    expect(withDatabaseVendor({ vendor: 'mysql', port: 3306 }, 'postgresql')).toEqual({ vendor: 'postgresql', port: 5432 });
    expect(withDatabaseVendor({ port: 6543 }, 'mysql')).toEqual({ vendor: 'mysql', port: 6543 });
  });
});

describe('Database type field', () => {
  it('shows PostgreSQL for a connector saved without a vendor, and saves MySQL with its port', () => {
    renderForm({ host: 'db', port: 5432, database: 'd', query: 'INSERT 1' });
    expect(screen.getByRole('combobox', { name: 'Database type' }).textContent).toBe('PostgreSQL');

    chooseVendor('MySQL or MariaDB');

    expect(lastProps).toMatchObject({ vendor: 'mysql', port: 3306, host: 'db', query: 'INSERT 1' });
  });

  it('is on the Database Reader too', () => {
    renderForm({ host: 'db', vendor: 'mysql', port: 3307, database: 'd', selectQuery: 'SELECT 1' }, true);
    expect(screen.getByRole('combobox', { name: 'Database type' }).textContent).toBe('MySQL or MariaDB');
    chooseVendor('PostgreSQL');
    expect(lastProps).toMatchObject({ vendor: 'postgresql', port: 3307 });
  });

  it('says an imported database with no driver will not deploy', () => {
    renderForm({ host: 'db', vendor: 'sqlserver', port: 1433, database: 'd', query: 'INSERT 1' });
    expect(screen.getByText(/no driver for sqlserver, so this channel will not deploy/)).toBeTruthy();
  });
});
