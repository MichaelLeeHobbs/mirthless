// ===========================================
// Role access over HTTP: PHI and destructive endpoints
// ===========================================
// docs/user/access-control.md says which roles can reach which endpoints. The
// role matrix guard only checks the doc against the seed; this test checks the
// routes themselves. Each request goes through the real router and the real
// permission middleware, signed in as each role. The controllers are stubbed to
// answer 200 with the name of the method that ran, so a 403 can only come from
// the permission check, and a request routed to the wrong handler fails.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction, type Router } from 'express';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { USER_ROLE, type Permission } from '@galvaniflow/core-models';
import { permissionNamesForRole } from '../../lib/role-permissions.js';
import attachmentRoutes from '../attachment.routes.js';
import deploymentRoutes from '../deployment.routes.js';
import messageReprocessRoutes from '../message-reprocess.routes.js';
import messageRoutes from '../message.routes.js';
import channelRoutes from '../channel.routes.js';
import codeTemplateRoutes from '../code-template.routes.js';
import eventExportRoutes from '../event-export.routes.js';
import eventRoutes from '../event.routes.js';
import collectionRoutes from '../collection.routes.js';
import settingsRoutes from '../settings.routes.js';
import serverBackupRoutes from '../server-backup.routes.js';
import logRoutes from '../log.routes.js';
import userRoutes from '../user.routes.js';

const { stubController } = vi.hoisted(() => ({
  /** A controller whose every method answers 200 with its own name, so only middleware can refuse. */
  stubController: (name: string): unknown => new Proxy({}, {
    get: (_target, method) => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(200).json({ handler: `${name}.${String(method)}` });
    },
  }),
}));

vi.mock('../../middleware/auth.middleware.js', async () => {
  const { permissionNamesForRole: names } = await import('../../lib/role-permissions.js');
  return {
    // Signs the request in as the role named in x-test-role.
    authenticate: (req: Request, _res: Response, next: NextFunction): void => {
      const role = String(req.headers['x-test-role'] ?? '');
      (req as Request & { user: unknown }).user = { id: 'u1', role, permissions: names(role) };
      next();
    },
  };
});
vi.mock('../../middleware/validate.middleware.js', () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction): void => { next(); },
}));
vi.mock('../../controllers/message.controller.js', () => ({ MessageController: stubController('MessageController') }));
vi.mock('../../controllers/message-export.controller.js', () => ({ MessageExportController: stubController('MessageExportController') }));
vi.mock('../../controllers/attachment.controller.js', () => ({ AttachmentController: stubController('AttachmentController') }));
vi.mock('../../controllers/message-reprocess.controller.js', () => ({ MessageReprocessController: stubController('MessageReprocessController') }));
vi.mock('../../controllers/deployment.controller.js', () => ({ DeploymentController: stubController('DeploymentController') }));
vi.mock('../../controllers/channel.controller.js', () => ({ ChannelController: stubController('ChannelController') }));
vi.mock('../../controllers/user.controller.js', () => ({ UserController: stubController('UserController') }));
vi.mock('../../controllers/settings.controller.js', () => ({ SettingsController: stubController('SettingsController') }));
vi.mock('../../controllers/event-export.controller.js', () => ({ EventExportController: stubController('EventExportController') }));
vi.mock('../../controllers/event.controller.js', () => ({ EventController: stubController('EventController') }));
vi.mock('../../controllers/server-backup.controller.js', () => ({ ServerBackupController: stubController('ServerBackupController') }));
vi.mock('../../controllers/code-template.controller.js', () => ({ CodeTemplateController: stubController('CodeTemplateController') }));
vi.mock('../../controllers/log.controller.js', () => ({ LogController: stubController('LogController') }));
vi.mock('../../controllers/collection.controller.js', () => ({ CollectionController: stubController('CollectionController') }));

const ID = '00000000-0000-0000-0000-000000000001';
const ROLES = Object.values(USER_ROLE);

interface Endpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  /** The permission docs/user/access-control.md says guards it. */
  readonly permission: Permission;
  /** The controller method that must answer. */
  readonly handler: string;
}

/** Endpoints that read PHI or secrets, run code, change access or destroy data. */
const ENDPOINTS: readonly Endpoint[] = [
  { method: 'GET', path: `/channels/${ID}/messages`, permission: 'messages:read', handler: 'MessageController.search' },
  { method: 'GET', path: `/channels/${ID}/messages/export`, permission: 'messages:read', handler: 'MessageExportController.exportMessages' },
  { method: 'GET', path: `/channels/${ID}/messages/1`, permission: 'messages:read', handler: 'MessageController.getDetail' },
  { method: 'GET', path: `/channels/${ID}/messages/1/attachments/a1`, permission: 'messages:read', handler: 'AttachmentController.getById' },
  { method: 'DELETE', path: `/channels/${ID}/messages/1`, permission: 'messages:delete', handler: 'MessageController.delete' },
  { method: 'DELETE', path: `/channels/${ID}/messages/bulk`, permission: 'messages:delete', handler: 'MessageReprocessController.bulkDelete' },
  { method: 'POST', path: `/channels/${ID}/messages/1/reprocess`, permission: 'messages:reprocess', handler: 'MessageReprocessController.reprocess' },
  { method: 'POST', path: `/channels/${ID}/messages/bulk-reprocess`, permission: 'messages:reprocess', handler: 'MessageReprocessController.bulkReprocess' },
  { method: 'POST', path: `/channels/${ID}/messages/1/connectors/1/resend`, permission: 'messages:reprocess', handler: 'MessageReprocessController.resend' },
  { method: 'POST', path: `/channels/${ID}/send-message`, permission: 'channels:deploy', handler: 'DeploymentController.sendMessage' },
  { method: 'POST', path: `/channels/${ID}/deploy`, permission: 'channels:deploy', handler: 'DeploymentController.deploy' },
  { method: 'GET', path: `/channels/${ID}`, permission: 'channels:read', handler: 'ChannelController.getById' },
  { method: 'PUT', path: `/channels/${ID}`, permission: 'channels:write', handler: 'ChannelController.update' },
  { method: 'DELETE', path: `/channels/${ID}`, permission: 'channels:delete', handler: 'ChannelController.delete' },
  { method: 'POST', path: '/users', permission: 'users:write', handler: 'UserController.create' },
  { method: 'PUT', path: `/users/${ID}`, permission: 'users:write', handler: 'UserController.update' },
  { method: 'POST', path: `/users/${ID}/password`, permission: 'users:write', handler: 'UserController.changePassword' },
  { method: 'DELETE', path: `/users/${ID}`, permission: 'users:delete', handler: 'UserController.delete' },
  { method: 'PUT', path: '/settings/bulk', permission: 'settings:write', handler: 'SettingsController.bulkUpsert' },
  { method: 'DELETE', path: '/events', permission: 'settings:write', handler: 'EventController.purge' },
  { method: 'GET', path: '/events/export', permission: 'events:read', handler: 'EventExportController.exportEvents' },
  { method: 'GET', path: '/system/backup', permission: 'system:backup', handler: 'ServerBackupController.exportBackup' },
  { method: 'POST', path: '/system/backup', permission: 'system:restore', handler: 'ServerBackupController.restoreBackup' },
  { method: 'GET', path: '/system/logs', permission: 'system:info', handler: 'LogController.getEntries' },
  { method: 'GET', path: `/collections/${ID}/records`, permission: 'collections:read', handler: 'CollectionController.listRecords' },
  { method: 'DELETE', path: `/collections/${ID}`, permission: 'collections:delete', handler: 'CollectionController.delete' },
  { method: 'PUT', path: `/code-templates/${ID}`, permission: 'code_templates:write', handler: 'CodeTemplateController.updateTemplate' },
  { method: 'DELETE', path: `/code-templates/${ID}`, permission: 'code_templates:delete', handler: 'CodeTemplateController.deleteTemplate' },
  { method: 'DELETE', path: `/code-templates/libraries/${ID}`, permission: 'code_templates:delete', handler: 'CodeTemplateController.deleteLibrary' },
];

/** Mount path and router variable name, in routes/index.ts order. */
const MOUNTS: ReadonlyArray<readonly [string, string, Router]> = [
  ['/channels', 'attachmentRoutes', attachmentRoutes],
  ['/channels', 'deploymentRoutes', deploymentRoutes],
  ['/channels', 'messageReprocessRoutes', messageReprocessRoutes],
  ['/channels', 'messageRoutes', messageRoutes],
  ['/channels', 'channelRoutes', channelRoutes],
  ['/code-templates', 'codeTemplateRoutes', codeTemplateRoutes],
  ['/events/export', 'eventExportRoutes', eventExportRoutes],
  ['/events', 'eventRoutes', eventRoutes],
  ['/collections', 'collectionRoutes', collectionRoutes],
  ['/settings', 'settingsRoutes', settingsRoutes],
  ['/system/backup', 'serverBackupRoutes', serverBackupRoutes],
  ['/system/logs', 'logRoutes', logRoutes],
  ['/users', 'userRoutes', userRoutes],
];

let server: Server;
let base: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  for (const [path, , router] of MOUNTS) app.use(path, router);
  return app;
}

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

async function call(role: string, e: Pick<Endpoint, 'method' | 'path'>): Promise<{ readonly status: number; readonly handler: string | undefined }> {
  const res = await fetch(`${base}${e.path}`, {
    method: e.method,
    headers: { 'x-test-role': role, 'content-type': 'application/json' },
    ...(e.method === 'GET' ? {} : { body: '{}' }),
  });
  const body = (await res.json().catch(() => ({}))) as { handler?: string };
  return { status: res.status, handler: body.handler };
}

describe('role access to PHI and destructive endpoints', () => {
  for (const e of ENDPOINTS) {
    it.each(ROLES)(`${e.method} ${e.path.replace(ID, ':id')} (${e.permission}) as %s`, async (role) => {
      const allowed = permissionNamesForRole(role).includes(e.permission);
      const result = await call(role, e);
      expect(result.status).toBe(allowed ? 200 : 403);
      if (allowed) expect(result.handler).toBe(e.handler);
    });
  }

  it('refuses a request with no role at all', async () => {
    expect((await call('', { method: 'GET', path: `/channels/${ID}/messages` })).status).toBe(403);
  });
});

describe('the test mounts routers where the server does', () => {
  it('matches each mount in routes/index.ts, in the same order', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const mounted = [...index.matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].map((m) => [m[1] ?? '', m[2] ?? ''] as const);
    const ours = MOUNTS.map(([path, name]) => [path, name] as const);
    for (const [path, name] of ours) expect(mounted, `${name} at ${path}`).toContainEqual([path, name]);
    const order = (list: ReadonlyArray<readonly [string, string]>): readonly string[] => list.map(([, n]) => n).filter((n) => ours.some(([, o]) => o === n));
    expect(order(ours)).toEqual(order(mounted));
  });
});
