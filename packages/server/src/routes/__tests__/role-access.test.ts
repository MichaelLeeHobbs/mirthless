// ===========================================
// Role access: the guard on every route
// ===========================================
// docs/user/access-control.md says which permission guards each PHI or
// destructive endpoint. This reads the real routers, with nothing mocked, and
// checks that every route runs a permission guard before anything else, and
// that each endpoint below is guarded by the permission the doc names and
// answered by the controller method named here.
//
// Which role that guard lets through is proved over HTTP, signed in as each
// role against Postgres, by test/integration/route-walk.itest.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import type { Permission } from '@galvanigraph/core-models';
import { permissionsOfGuard, requirePermission } from '../../middleware/permission.middleware.js';
import { walkApiRoutes, isPublic, SESSION_ONLY_ROUTES, type ApiRoute, type WalkedRoute } from './api-routes.js';
import { MessageController } from '../../controllers/message.controller.js';
import { MessageExportController } from '../../controllers/message-export.controller.js';
import { AttachmentController } from '../../controllers/attachment.controller.js';
import { MessageReprocessController } from '../../controllers/message-reprocess.controller.js';
import { DeploymentController } from '../../controllers/deployment.controller.js';
import { ChannelController } from '../../controllers/channel.controller.js';
import { ChannelGroupController } from '../../controllers/channel-group.controller.js';
import { UserController } from '../../controllers/user.controller.js';
import { SettingsController } from '../../controllers/settings.controller.js';
import { EventController } from '../../controllers/event.controller.js';
import { EventExportController } from '../../controllers/event-export.controller.js';
import { ServerBackupController } from '../../controllers/server-backup.controller.js';
import { LogController } from '../../controllers/log.controller.js';
import { CollectionController } from '../../controllers/collection.controller.js';
import { CodeTemplateController } from '../../controllers/code-template.controller.js';
import { AuditController } from '../../controllers/audit.controller.js';
import { RoleController } from '../../controllers/role.controller.js';
import { ApiKeyController } from '../../controllers/api-key.controller.js';
import { CrossChannelSearchController } from '../../controllers/cross-channel-search.controller.js';

interface Endpoint extends ApiRoute {
  /** The permission docs/user/access-control.md says guards it. */
  readonly permission: Permission;
  /** The controller method that answers it. */
  readonly handler: unknown;
}

const C = '/api/v1/channels/:id';

/** Endpoints that read PHI or secrets, run code, change access or destroy data. */
const ENDPOINTS: readonly Endpoint[] = [
  { method: 'GET', path: `${C}/messages`, permission: 'messages:read', handler: MessageController.search },
  { method: 'GET', path: `${C}/messages/export`, permission: 'messages:read', handler: MessageExportController.exportMessages },
  { method: 'GET', path: `${C}/messages/:msgId`, permission: 'messages:read', handler: MessageController.getDetail },
  { method: 'GET', path: `${C}/messages/:msgId/attachments/:attachmentId`, permission: 'messages:read', handler: AttachmentController.getById },
  { method: 'DELETE', path: `${C}/messages/:msgId`, permission: 'messages:delete', handler: MessageController.delete },
  { method: 'DELETE', path: `${C}/messages/bulk`, permission: 'messages:delete', handler: MessageReprocessController.bulkDelete },
  { method: 'POST', path: `${C}/messages/:msgId/reprocess`, permission: 'messages:reprocess', handler: MessageReprocessController.reprocess },
  { method: 'POST', path: `${C}/messages/bulk-reprocess`, permission: 'messages:reprocess', handler: MessageReprocessController.bulkReprocess },
  { method: 'POST', path: `${C}/messages/:msgId/connectors/:metaDataId/resend`, permission: 'messages:reprocess', handler: MessageReprocessController.resend },
  { method: 'POST', path: `${C}/send-message`, permission: 'channels:deploy', handler: DeploymentController.sendMessage },
  { method: 'POST', path: `${C}/deploy`, permission: 'channels:deploy', handler: DeploymentController.deploy },
  { method: 'GET', path: C, permission: 'channels:read', handler: ChannelController.getById },
  { method: 'PUT', path: C, permission: 'channels:write', handler: ChannelController.update },
  { method: 'DELETE', path: C, permission: 'channels:delete', handler: ChannelController.delete },
  // Group membership will decide who can read a channel's PHI once access goes by group (#160).
  { method: 'PUT', path: `${C}/groups`, permission: 'channels:write', handler: ChannelGroupController.setChannelGroups },
  { method: 'POST', path: '/api/v1/users', permission: 'users:write', handler: UserController.create },
  { method: 'PUT', path: '/api/v1/users/:id', permission: 'users:write', handler: UserController.update },
  { method: 'PUT', path: '/api/v1/users/:id/assignments', permission: 'users:write', handler: UserController.setAssignments },
  { method: 'POST', path: '/api/v1/users/:id/password', permission: 'users:write', handler: UserController.changePassword },
  { method: 'DELETE', path: '/api/v1/users/:id', permission: 'users:delete', handler: UserController.delete },
  { method: 'PUT', path: '/api/v1/settings/bulk', permission: 'settings:write', handler: SettingsController.bulkUpsert },
  { method: 'DELETE', path: '/api/v1/events', permission: 'settings:write', handler: EventController.purge },
  { method: 'GET', path: '/api/v1/events/export', permission: 'events:read', handler: EventExportController.exportEvents },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit:read', handler: AuditController.list },
  { method: 'GET', path: '/api/v1/audit/:id', permission: 'audit:read', handler: AuditController.getById },
  // Message ids, status and times from every channel in scope (D-310).
  { method: 'GET', path: '/api/v1/messages', permission: 'messages:read', handler: CrossChannelSearchController.search },
  // A key acts as a principal of its own; issuing, enabling and revoking one change who can reach what (D-313).
  { method: 'GET', path: '/api/v1/api-keys', permission: 'api_keys:read', handler: ApiKeyController.list },
  { method: 'POST', path: '/api/v1/api-keys', permission: 'api_keys:manage', handler: ApiKeyController.issue },
  { method: 'PATCH', path: '/api/v1/api-keys/:id/enabled', permission: 'api_keys:manage', handler: ApiKeyController.setEnabled },
  { method: 'POST', path: '/api/v1/api-keys/:id/revoke', permission: 'api_keys:manage', handler: ApiKeyController.revoke },
  { method: 'POST', path: '/api/v1/api-keys/:id/replace', permission: 'api_keys:manage', handler: ApiKeyController.replace },
  // A role change changes what every holder may do (D-310).
  { method: 'POST', path: '/api/v1/roles', permission: 'roles:write', handler: RoleController.create },
  { method: 'PUT', path: '/api/v1/roles/:id', permission: 'roles:write', handler: RoleController.update },
  { method: 'DELETE', path: '/api/v1/roles/:id', permission: 'roles:write', handler: RoleController.delete },
  { method: 'GET', path: '/api/v1/system/backup', permission: 'system:backup', handler: ServerBackupController.exportBackup },
  { method: 'POST', path: '/api/v1/system/backup', permission: 'system:restore', handler: ServerBackupController.restoreBackup },
  { method: 'GET', path: '/api/v1/system/logs', permission: 'system:info', handler: LogController.getEntries },
  { method: 'GET', path: '/api/v1/collections/:id/records', permission: 'collections:read', handler: CollectionController.listRecords },
  { method: 'DELETE', path: '/api/v1/collections/:id', permission: 'collections:delete', handler: CollectionController.delete },
  { method: 'PUT', path: '/api/v1/code-templates/:id', permission: 'code_templates:write', handler: CodeTemplateController.updateTemplate },
  { method: 'DELETE', path: '/api/v1/code-templates/:id', permission: 'code_templates:delete', handler: CodeTemplateController.deleteTemplate },
  { method: 'DELETE', path: '/api/v1/code-templates/libraries/:id', permission: 'code_templates:delete', handler: CodeTemplateController.deleteLibrary },
];

const same = (a: ApiRoute) => (b: ApiRoute): boolean => a.method === b.method && a.path === b.path;
const label = (r: ApiRoute): string => `${r.method} ${r.path}`;

let routes: readonly WalkedRoute[];

beforeAll(async () => {
  routes = await walkApiRoutes((await import('../index.js')).default);
}, 60_000); // Loads every router and controller; under a full parallel run that outlasts the 10 s hook default.

/** Routes that are neither public nor session-only and do not run a permission guard first. */
function unguarded(walked: readonly WalkedRoute[]): readonly string[] {
  return walked
    .filter((r) => !isPublic(r) && !SESSION_ONLY_ROUTES.some(same(r)))
    .filter((r) => permissionsOfGuard(r.handlers[0]) === undefined)
    .map(label);
}

describe('every route is guarded first', () => {
  it('runs a permission guard before any other handler, unless the route is public or session-only', () => {
    expect(unguarded(routes)).toEqual([]);
  });

  it('catches a route with no guard, or with its guard after another handler', () => {
    const handler = (): void => undefined;
    const fixtures: readonly WalkedRoute[] = [
      { method: 'POST', path: '/api/v1/admin/prune', handlers: [handler] },
      { method: 'GET', path: '/api/v1/system', handlers: [handler, requirePermission('system:info'), handler] },
      { method: 'GET', path: '/api/v1/tags', handlers: [requirePermission('settings:read'), handler] },
    ];
    expect(unguarded(fixtures)).toEqual(['POST /api/v1/admin/prune', 'GET /api/v1/system']);
  });

  it('lists only session-only routes that exist and have no guard, so the list cannot go stale', () => {
    for (const s of SESSION_ONLY_ROUTES) {
      const route = routes.find(same(s));
      expect(route, label(s)).toBeDefined();
      expect(route?.handlers.some((h) => permissionsOfGuard(h) !== undefined), label(s)).toBe(false);
    }
  });
});

describe('PHI and destructive endpoints', () => {
  it.each(ENDPOINTS.map((e) => [label(e), e] as const))('%s is guarded as the access doc says', (_name, e) => {
    const route = routes.find(same(e));
    expect(route).toBeDefined();
    expect(permissionsOfGuard(route?.handlers[0])).toEqual([e.permission]);
    expect(route?.handlers.at(-1)).toBe(e.handler);
  });
});
