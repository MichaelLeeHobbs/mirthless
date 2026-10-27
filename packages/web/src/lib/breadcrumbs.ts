// ===========================================
// Breadcrumbs
// ===========================================
// Builds the header's breadcrumb trail from the URL, so pages don't each
// hand-roll one. Every trail starts at the Dashboard; top-level pages take
// their label from the sidebar, and the two nested areas (a channel and its
// messages, an alert) add the record's name.

export interface Crumb {
  readonly label: string;
  /** Where the crumb links to. The last crumb is the current page and has none. */
  readonly href?: string;
}

/** A page the sidebar knows: its label and path. */
export interface CrumbPage {
  readonly label: string;
  readonly path: string;
}

/** The record a nested route is about, whose name the header has to look up. */
export interface CrumbEntity {
  readonly kind: 'channel' | 'alert';
  readonly id: string;
}

const HOME: Crumb = { label: 'Dashboard', href: '/' };

function segmentsOf(pathname: string): readonly string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

/** The channel or alert a URL points at, or null when it names no record. */
export function crumbEntity(pathname: string): CrumbEntity | null {
  const [area, id] = segmentsOf(pathname);
  if (id === undefined || id === 'new') return null;
  if (area === 'channels') return { kind: 'channel', id };
  if (area === 'alerts') return { kind: 'alert', id };
  return null;
}

function channelTrail(rest: readonly string[], name: string | undefined): readonly Crumb[] {
  const [id, sub] = rest;
  if (id === 'new') return [HOME, { label: 'New channel' }];
  const label = name ?? 'Channel';
  if (sub === 'messages') return [HOME, { label, href: `/channels/${id ?? ''}` }, { label: 'Messages' }];
  return [HOME, { label }];
}

function alertTrail(rest: readonly string[], name: string | undefined): readonly Crumb[] {
  const [id] = rest;
  if (id === undefined) return [HOME, { label: 'Alerts' }];
  const alerts: Crumb = { label: 'Alerts', href: '/alerts' };
  return [HOME, alerts, { label: id === 'new' ? 'New alert' : (name ?? 'Alert') }];
}

/**
 * The breadcrumb trail for a URL.
 * @param pathname - The router's current path.
 * @param pages - The sidebar's pages, for top-level labels.
 * @param entityName - The name of the record from {@link crumbEntity}, once loaded.
 */
export function breadcrumbsFor(
  pathname: string,
  pages: readonly CrumbPage[],
  entityName: string | undefined,
): readonly Crumb[] {
  const [area, ...rest] = segmentsOf(pathname);
  if (area === undefined) return [{ label: HOME.label }];
  if (area === 'channels') return channelTrail(rest, entityName);
  if (area === 'alerts') return alertTrail(rest, entityName);
  const normalized = `/${[area, ...rest].join('/')}`;
  const page = pages.find((p) => p.path === normalized);
  return page ? [HOME, { label: page.label }] : [HOME];
}
