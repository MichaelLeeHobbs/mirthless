// ===========================================
// Role access over HTTP: PHI and destructive endpoints
// ===========================================
// docs/user/access-control.md says which roles can reach which endpoints. The
// role matrix guard only checks the doc against the seed; this test checks the
// routes themselves. Each request goes through the real router and the real
// permission middleware, signed in as each role; the controllers are stubbed to
// answer 200, so a 403 can only come from the permission check.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
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
import collectionRoutes from '../collection.routes.js';
import settingsRoutes from '../settings.routes.js';
import serverBackupRoutes from '../server-backup.routes.js';
import logRoutes from '../log.routes.js';
import userRoutes from '../user.routes.js';

const { stubController } = vi.hoisted(() => ({
  /** A controller whose every method answers 200, so only middleware can refuse. */
  stubController: (): unknown => new Proxy({}, {
    get: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => { res.status(200).json({ ok: true }); },
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
vi.mock('../../controllers/message.controller.js', () => ({ MessageController: stubController() }));
vi.mock('../../controllers/message-export.controller.js', () => ({ MessageExportController: stubController() }));
vi.mock('../../controllers/attachment.controller.js', () => ({ AttachmentController: stubController() }));
vi.mock('../../controllers/message-reprocess.controller.js', () => ({ MessageReprocessController: stubController() }));
vi.mock('../../controllers/deployment.controller.js', () => ({ DeploymentController: stubController() }));
vi.mock('../../controllers/channel.controller.js', () => ({ ChannelController: stubController() }));
vi.mock('../../controllers/user.controller.js', () => ({ UserController: stubController() }));
vi.mock('../../controllers/settings.controller.js', () => ({ SettingsController: stubController() }));
vi.mock('../../controllers/event-export.controller.js', () => ({ EventExportController: stubController() }));
vi.mock('../../controllers/server-backup.controller.js', () => ({ ServerBackupController: stubController() }));
vi.mock('../../controllers/code-template.controller.js', () => ({ CodeTemplateController: stubController() }));
vi.mock('../../controllers/log.controller.js', () => ({ LogController: stubController() }));
vi.mock('../../controllers/collection.controller.js', () => ({ CollectionController: stubController() }));

const ID = '00000000-0000-0000-0000-000000000001';
const ROLES = Object.values(USER_ROLE);

interface Endpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  /** The permission docs/user/access-control.md says guards it. */
  readonly permission: Permission;
}

/** Endpoints that read PHI or secrets, run code, or destroy data. */
const ENDPOINTS: readonly Endpoint[] = [
  { method: 'GET', path: `/channels/${ID}/messages`, permission: 'messages:read' },
  { method: 'GET', path: `/channels/${ID}/messages/export`, permission: 'messages:read' },
  { method: 'GET', path: `/channels/${ID}/messages/1/attachments/a1`, permission: 'messages:read' },
  { method: 'DELETE', path: `/channels/${ID}/messages/1`, permission: 'messages:delete' },
  { method: 'DELETE', path: `/channels/${ID}/messages/bulk`, permission: 'messages:delete' },
  { method: 'POST', path: `/channels/${ID}/messages/1/reprocess`, permission: 'messages:reprocess' },
  { method: 'POST', path: `/channels/${ID}/send-message`, permission: 'channels:deploy' },
  { method: 'POST', path: `/channels/${ID}/deploy`, permission: 'channels:deploy' },
  { method: 'PUT', path: `/channels/${ID}`, permission: 'channels:write' },
  { method: 'DELETE', path: `/channels/${ID}`, permission: 'channels:delete' },
  { method: 'POST', path: '/users', permission: 'users:write' },
  { method: 'DELETE', path: `/users/${ID}`, permission: 'users:delete' },
  { method: 'PUT', path: '/settings/bulk', permission: 'settings:write' },
  { method: 'GET', path: '/events/export', permission: 'events:read' },
  { method: 'GET', path: '/system/backup', permission: 'system:backup' },
  { method: 'POST', path: '/system/backup', permission: 'system:restore' },
  { method: 'GET', path: '/system/logs', permission: 'system:info' },
  { method: 'GET', path: `/collections/${ID}/records`, permission: 'collections:read' },
  { method: 'DELETE', path: `/collections/${ID}`, permission: 'collections:delete' },
  { method: 'PUT', path: `/code-templates/${ID}`, permission: 'code_templates:write' },
  { method: 'DELETE', path: `/code-templates/${ID}`, permission: 'code_templates:delete' },
  { method: 'DELETE', path: `/code-templates/libraries/${ID}`, permission: 'code_templates:delete' },
];

let server: Server;
let base: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Same mount order as routes/index.ts, where several routers share /channels.
  app.use('/channels', attachmentRoutes);
  app.use('/channels', deploymentRoutes);
  app.use('/channels', messageReprocessRoutes);
  app.use('/channels', messageRoutes);
  app.use('/channels', channelRoutes);
  app.use('/code-templates', codeTemplateRoutes);
  app.use('/events/export', eventExportRoutes);
  app.use('/collections', collectionRoutes);
  app.use('/settings', settingsRoutes);
  app.use('/system/backup', serverBackupRoutes);
  app.use('/system/logs', logRoutes);
  app.use('/users', userRoutes);
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

async function status(role: string, e: Pick<Endpoint, 'method' | 'path'>): Promise<number> {
  const res = await fetch(`${base}${e.path}`, {
    method: e.method,
    headers: { 'x-test-role': role, 'content-type': 'application/json' },
    ...(e.method === 'GET' ? {} : { body: '{}' }),
  });
  return res.status;
}

describe('role access to PHI and destructive endpoints', () => {
  for (const e of ENDPOINTS) {
    it.each(ROLES)(`${e.method} ${e.path.replace(ID, ':id')} (${e.permission}) as %s`, async (role) => {
      const allowed = permissionNamesForRole(role).includes(e.permission);
      expect(await status(role, e)).toBe(allowed ? 200 : 403);
    });
  }

  it('refuses a request with no role at all', async () => {
    expect(await status('', { method: 'GET', path: `/channels/${ID}/messages` })).toBe(403);
  });
});
