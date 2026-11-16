// ===========================================
// Code Template Route Permission Tests
// ===========================================
// Sends real requests through the router to check which permission each
// write and delete route enforces.

import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../middleware/auth.middleware.js', () => ({
  // Stands in for JWT auth: the test names the caller's permissions in a header.
  authenticate: vi.fn((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const header = req.header('x-test-permissions') ?? '';
    req.user = {
      id: 'user-1',
      username: 'tester',
      email: 'tester@example.com',
      role: 'test',
      isActive: true,
      permissions: header === '' ? [] : header.split(','),
      mustChangePassword: false,
    };
    next();
  }),
}));

const ok = (_req: express.Request, res: express.Response): void => { res.status(200).json({ success: true }); };

vi.mock('../../controllers/code-template.controller.js', () => ({
  CodeTemplateController: {
    listLibraries: ok,
    createLibrary: ok,
    updateLibrary: ok,
    deleteLibrary: ok,
    listTemplates: ok,
    createTemplate: ok,
    updateTemplate: ok,
    deleteTemplate: ok,
  },
}));

const { authenticate } = await import('../../middleware/auth.middleware.js');
const router = (await import('../code-template.routes.js')).default;

const ID = '00000000-0000-4000-8000-000000000001';
let server: Server | null = null;

async function del(path: string, permissions: readonly string[]): Promise<number> {
  const app = express();
  // routes/index.ts authenticates once in front of every router.
  app.use(authenticate);
  app.use('/code-templates', router);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${String(port)}/code-templates${path}`, {
    method: 'DELETE',
    headers: { 'x-test-permissions': permissions.join(','), connection: 'close' },
  });
  return response.status;
}

afterEach(async () => {
  const running = server;
  if (running) await new Promise((resolve) => { running.close(resolve); });
  server = null;
});

describe('code template delete routes', () => {
  const paths = [`/libraries/${ID}`, `/${ID}`];

  it.each(paths)('DELETE %s returns 403 for a role with code_templates:write but not delete', async (path) => {
    expect(await del(path, ['code_templates:read', 'code_templates:write'])).toBe(403);
  });

  it.each(paths)('DELETE %s succeeds for a role with code_templates:delete', async (path) => {
    expect(await del(path, ['code_templates:delete'])).toBe(200);
  });
});
