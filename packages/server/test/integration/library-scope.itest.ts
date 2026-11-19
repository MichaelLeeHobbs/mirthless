// A library's templates are compiled into the channels it links to, so a
// library or template write needs the permission on every linked channel,
// before and after the change.

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  apiCall, deleteTestChannel, describeIntegration, insertTestChannel, insertTestGroup, loadServerModules, userWithRole,
  type ApiAnswer, type ServerModules, type TestUser,
} from './_setup.js';

interface Library { readonly id: string; readonly revision: number; readonly channelIds: string[] | null; readonly outsideScopeCount: number }

describeIntegration('code template library links and scope (real Postgres)', () => {
  let mods: ServerModules;
  let server: Server;
  let base: string;
  const users: string[] = [];
  const groups: string[] = [];
  const libraries: string[] = [];
  const LAB_CHANNEL = randomUUID();
  const RAD_CHANNEL = randomUUID();
  const extraChannels: string[] = [];
  let lab: string;
  let admin: TestUser;

  async function user(role: string, groupIds: readonly string[] | null): Promise<TestUser> {
    const made = await userWithRole(mods.pool, role, groupIds);
    users.push(made.id);
    return made;
  }

  const call = <T>(who: TestUser, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> => apiCall<T>(base, who.token, method, path, body);

  async function library(who: TestUser, channelIds?: string[] | null): Promise<ApiAnswer<Library>> {
    const res = await call<Library>(who, 'POST', '/code-templates/libraries', {
      name: `itest-lib-${randomUUID().slice(0, 8)}`, ...(channelIds === undefined ? {} : { channelIds }),
    });
    if (res.json.data) libraries.push(res.json.data.id);
    return res;
  }

  const template = (libraryId: string): Record<string, unknown> => ({
    libraryId, name: `itest-tpl-${randomUUID().slice(0, 8)}`, type: 'CODE_BLOCK', code: '// nothing', contexts: ['GLOBAL_DEPLOY'],
  });

  beforeAll(async () => {
    process.env['API_RATE_LIMIT_MAX'] = '1000000';
    mods = await loadServerModules();
    lab = await insertTestGroup(mods.pool);
    const rad = await insertTestGroup(mods.pool);
    groups.push(lab, rad);
    await insertTestChannel(mods, LAB_CHANNEL);
    await insertTestChannel(mods, RAD_CHANNEL);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $4)', [lab, LAB_CHANNEL, rad, RAD_CHANNEL]);
    admin = await user('admin', null);
    const app = (await import('../../src/app.js')).default;
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => { resolve(); }); });
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => { server?.close(() => { resolve(); }); });
    if (libraries.length > 0) await mods.pool.query('DELETE FROM code_template_libraries WHERE id = ANY($1::uuid[])', [libraries]);
    if (users.length > 0) await mods.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    const channelIds = [LAB_CHANNEL, RAD_CHANNEL, ...extraChannels];
    await mods.pool.query('DELETE FROM channel_group_members WHERE channel_id = ANY($1::uuid[])', [channelIds]);
    for (const id of channelIds) await deleteTestChannel(mods, id);
    if (groups.length > 0) await mods.pool.query('DELETE FROM channel_groups WHERE id = ANY($1::uuid[])', [groups]);
    await mods.pool.end();
  });

  it('lets a scoped writer create a library only on channels in scope, defaulting to their own', async () => {
    const writer = await user('channel-developer', [lab]);
    expect((await library(writer, [LAB_CHANNEL])).status).toBe(201);
    expect((await library(writer, [LAB_CHANNEL, RAD_CHANNEL])).status).toBe(403);
    expect((await library(writer, null)).status).toBe(403);
    expect((await library(writer, [])).status).toBe(403);
    const defaulted = await library(writer);
    expect(defaulted.status).toBe(201);
    expect(defaulted.json.data?.channelIds).toEqual([LAB_CHANNEL]);
    expect((await library(admin)).json.data?.channelIds).toBeNull();
  });

  it('judges a library update on its links before and after the change', async () => {
    const writer = await user('channel-developer', [lab]);
    const wide = (await library(admin, [LAB_CHANNEL, RAD_CHANNEL])).json.data!;
    expect((await call(writer, 'PUT', `/code-templates/libraries/${wide.id}`, { name: `itest-lib-${randomUUID().slice(0, 8)}`, revision: wide.revision })).status).toBe(403);
    expect((await call(writer, 'PUT', `/code-templates/libraries/${wide.id}`, { channelIds: [LAB_CHANNEL], revision: wide.revision })).status).toBe(403);

    const mine = (await library(writer, [LAB_CHANNEL])).json.data!;
    expect((await call(writer, 'PUT', `/code-templates/libraries/${mine.id}`, { channelIds: [LAB_CHANNEL, RAD_CHANNEL], revision: mine.revision })).status).toBe(403);
    expect((await call(writer, 'PUT', `/code-templates/libraries/${mine.id}`, { channelIds: null, revision: mine.revision })).status).toBe(403);
    expect((await call(writer, 'PUT', `/code-templates/libraries/${mine.id}`, { description: 'renamed', revision: mine.revision })).status).toBe(200);
  });

  it('judges a template write on its library\'s links', async () => {
    const writer = await user('channel-developer', [lab]);
    const everyone = (await library(admin, null)).json.data!;
    const wide = (await library(admin, [LAB_CHANNEL, RAD_CHANNEL])).json.data!;
    const mine = (await library(writer, [LAB_CHANNEL])).json.data!;
    expect((await call(writer, 'POST', '/code-templates', template(everyone.id))).status).toBe(403);
    expect((await call(writer, 'POST', '/code-templates', template(wide.id))).status).toBe(403);
    const made = await call<{ id: string; revision: number }>(writer, 'POST', '/code-templates', template(mine.id));
    expect(made.status).toBe(201);

    const theirs = (await call<{ id: string; revision: number }>(admin, 'POST', '/code-templates', template(wide.id))).json.data!;
    expect((await call(writer, 'PUT', `/code-templates/${theirs.id}`, { code: '// changed', revision: theirs.revision })).status).toBe(403);
    expect((await call(writer, 'PUT', `/code-templates/${made.json.data!.id}`, { code: '// changed', revision: made.json.data!.revision })).status).toBe(200);
  });

  it('judges a delete on code_templates:delete over the library\'s links', async () => {
    const deleter = await user('channel-deployer', [lab]);
    const mine = (await library(admin, [LAB_CHANNEL])).json.data!;
    const everyone = (await library(admin, null)).json.data!;
    const tpl = (await call<{ id: string }>(admin, 'POST', '/code-templates', template(everyone.id))).json.data!;
    expect((await call(deleter, 'DELETE', `/code-templates/${tpl.id}`)).status).toBe(403);
    expect((await call(deleter, 'DELETE', `/code-templates/libraries/${everyone.id}`)).status).toBe(403);
    expect((await call(deleter, 'DELETE', `/code-templates/libraries/${mine.id}`)).status).toBe(204);
  });

  it('holds a channel in two groups through either, and leaves a refused library as it was', async () => {
    const both = randomUUID();
    await insertTestChannel(mods, both);
    extraChannels.push(both);
    await mods.pool.query('INSERT INTO channel_group_members (channel_group_id, channel_id) VALUES ($1, $2), ($3, $2)', [lab, both, groups[1]]);
    const writer = await user('channel-developer', [lab]);
    const made = (await library(writer, [both])).json.data!;
    expect(made.channelIds).toEqual([both]);

    const refused = await call(writer, 'PUT', `/code-templates/libraries/${made.id}`, { channelIds: [both, RAD_CHANNEL], revision: made.revision });
    expect(refused.status).toBe(403);
    const { rows } = await mods.pool.query<{ channel_ids: string[]; revision: number }>('SELECT channel_ids, revision FROM code_template_libraries WHERE id = $1', [made.id]);
    expect(rows[0]).toEqual({ channel_ids: [both], revision: made.revision });
  });

  it('refuses a write with no signed-in actor', async () => {
    const { CodeTemplateService } = await import('../../src/services/code-template.service.js');
    const result = await CodeTemplateService.createLibrary({ name: `itest-lib-${randomUUID().slice(0, 8)}`, description: '', channelIds: [LAB_CHANNEL] });
    expect(result.ok).toBe(false);
  });

  it('refuses a Mirth template import before writing any library when one is out of scope', async () => {
    const writer = await user('channel-developer', [lab]);
    const { importCodeTemplateLibraries } = await import('../../src/services/mirth-code-templates.js');
    const inScope = `itest-lib-${randomUUID().slice(0, 8)}`;
    const result = await importCodeTemplateLibraries([
      { name: inScope, description: '', channelIds: [LAB_CHANNEL], templates: [] },
      { name: `itest-lib-${randomUUID().slice(0, 8)}`, description: '', channelIds: null, templates: [] },
    ], false, { userId: writer.id, ipAddress: null });
    expect(result.ok).toBe(false);
    const { rows } = await mods.pool.query('SELECT 1 FROM code_template_libraries WHERE name = $1', [inScope]);
    expect(rows).toHaveLength(0);
  });

  it('shows a scoped reader only the links in scope, with a count of the rest', async () => {
    const reader = await user('channel-viewer', [lab]);
    const wide = (await library(admin, [LAB_CHANNEL, RAD_CHANNEL])).json.data!;
    const everyone = (await library(admin, null)).json.data!;
    const listed = (await call<Library[]>(reader, 'GET', '/code-templates/libraries')).json.data!;
    expect(listed.find((l) => l.id === wide.id)).toMatchObject({ channelIds: [LAB_CHANNEL], outsideScopeCount: 1 });
    expect(listed.find((l) => l.id === everyone.id)).toMatchObject({ channelIds: null, outsideScopeCount: 0 });
    const full = (await call<Library[]>(admin, 'GET', '/code-templates/libraries')).json.data!;
    expect(full.find((l) => l.id === wide.id)).toMatchObject({ channelIds: [LAB_CHANNEL, RAD_CHANNEL], outsideScopeCount: 0 });
  });
});
