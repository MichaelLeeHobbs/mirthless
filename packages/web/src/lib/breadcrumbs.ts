export interface Crumb {
  readonly label: string;
  /** Absent on the last crumb, the current page. */
  readonly href?: string;
}

export interface CrumbPage {
  readonly label: string;
  readonly path: string;
}

export interface CrumbEntity {
  readonly kind: 'channel' | 'alert' | 'collection';
  readonly id: string;
}

const HOME: Crumb = { label: 'Dashboard', href: '/' };

function segmentsOf(pathname: string): readonly string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

export function crumbEntity(pathname: string): CrumbEntity | null {
  const [area, id, sub] = segmentsOf(pathname);
  if (id === undefined || id === 'new') return null;
  if (area === 'channels') return { kind: 'channel', id };
  if (area === 'alerts') return { kind: 'alert', id };
  if (area === 'collections' && sub === 'records') return { kind: 'collection', id };
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

function roleTrail(rest: readonly string[]): readonly Crumb[] {
  const [id] = rest;
  if (id === undefined) return [HOME, { label: 'Roles' }];
  return [HOME, { label: 'Roles', href: '/roles' }, { label: id === 'new' ? 'New role' : 'Edit role' }];
}

function collectionTrail(rest: readonly string[], name: string | undefined): readonly Crumb[] {
  const [, sub] = rest;
  if (sub !== 'records') return [HOME, { label: 'Collections' }];
  return [HOME, { label: 'Collections', href: '/collections' }, { label: name ?? 'Records' }];
}

export function breadcrumbsFor(
  pathname: string,
  pages: readonly CrumbPage[],
  entityName: string | undefined,
): readonly Crumb[] {
  const [area, ...rest] = segmentsOf(pathname);
  if (area === undefined) return [{ label: HOME.label }];
  if (area === 'channels') return channelTrail(rest, entityName);
  if (area === 'alerts') return alertTrail(rest, entityName);
  if (area === 'collections') return collectionTrail(rest, entityName);
  if (area === 'roles') return roleTrail(rest);
  const normalized = `/${[area, ...rest].join('/')}`;
  const page = pages.find((p) => p.path === normalized);
  return page ? [HOME, { label: page.label }] : [HOME];
}
