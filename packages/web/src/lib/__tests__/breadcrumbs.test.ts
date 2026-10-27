import { describe, it, expect } from 'vitest';
import { breadcrumbsFor, crumbEntity } from '../breadcrumbs.js';

const PAGES = [
  { label: 'Dashboard', path: '/' },
  { label: 'Alerts', path: '/alerts' },
  { label: 'Tags', path: '/tags' },
  { label: 'Tools', path: '/tools/message-generator' },
];

describe('crumbEntity', () => {
  it('finds the channel or alert a URL is about', () => {
    expect(crumbEntity('/channels/abc')).toEqual({ kind: 'channel', id: 'abc' });
    expect(crumbEntity('/channels/abc/messages')).toEqual({ kind: 'channel', id: 'abc' });
    expect(crumbEntity('/alerts/xyz')).toEqual({ kind: 'alert', id: 'xyz' });
  });

  it('returns null for new records, lists and other pages', () => {
    expect(crumbEntity('/channels/new')).toBeNull();
    expect(crumbEntity('/alerts/new')).toBeNull();
    expect(crumbEntity('/alerts')).toBeNull();
    expect(crumbEntity('/')).toBeNull();
    expect(crumbEntity('/tools/message-generator')).toBeNull();
  });
});

describe('breadcrumbsFor', () => {
  it('shows only the Dashboard, unlinked, on the Dashboard', () => {
    expect(breadcrumbsFor('/', PAGES, undefined)).toEqual([{ label: 'Dashboard' }]);
  });

  it('labels a top-level page from the sidebar', () => {
    expect(breadcrumbsFor('/tags', PAGES, undefined)).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'Tags' },
    ]);
    expect(breadcrumbsFor('/tools/message-generator/', PAGES, undefined)).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'Tools' },
    ]);
  });

  it('falls back to the Dashboard alone for a page the sidebar does not know', () => {
    expect(breadcrumbsFor('/nowhere', PAGES, undefined)).toEqual([{ label: 'Dashboard', href: '/' }]);
  });

  it('names a channel, and links it from its messages', () => {
    expect(breadcrumbsFor('/channels/c1', PAGES, 'ADT in')).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'ADT in' },
    ]);
    expect(breadcrumbsFor('/channels/c1/messages', PAGES, 'ADT in')).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'ADT in', href: '/channels/c1' }, { label: 'Messages' },
    ]);
  });

  it('uses a placeholder until the channel name loads', () => {
    expect(breadcrumbsFor('/channels/c1/messages', PAGES, undefined)[1]?.label).toBe('Channel');
  });

  it('labels a new channel', () => {
    expect(breadcrumbsFor('/channels/new', PAGES, undefined)).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'New channel' },
    ]);
  });

  it('nests an alert under Alerts', () => {
    expect(breadcrumbsFor('/alerts', PAGES, undefined)).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'Alerts' },
    ]);
    expect(breadcrumbsFor('/alerts/a1', PAGES, 'Errors')).toEqual([
      { label: 'Dashboard', href: '/' }, { label: 'Alerts', href: '/alerts' }, { label: 'Errors' },
    ]);
    expect(breadcrumbsFor('/alerts/a1', PAGES, undefined)[2]?.label).toBe('Alert');
    expect(breadcrumbsFor('/alerts/new', PAGES, undefined)[2]?.label).toBe('New alert');
  });
});
