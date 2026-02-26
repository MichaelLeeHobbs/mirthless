# 05 — Server API Design

> Express REST API, authentication, authorization, and deployment orchestration.

## Architecture

```
Express App
  │
  ├── Middleware: helmet, cors, compression, cookieParser, json
  ├── Middleware: requestId, requestLogging (pino-http)
  ├── Middleware: rateLimiter (on /api/v1)
  │
  ├── /api/v1/auth          → authRoutes      (public, rate-limited)
  ├── /api/v1/channels      → channelRoutes   (protected)
  ├── /api/v1/messages      → messageRoutes   (protected)
  ├── /api/v1/code-templates → templateRoutes  (protected)
  ├── /api/v1/alerts        → alertRoutes     (protected)
  ├── /api/v1/users         → userRoutes      (protected, admin)
  ├── /api/v1/config        → configRoutes    (protected, admin)
  ├── /api/v1/events        → eventRoutes     (protected)
  ├── /api/v1/system        → systemRoutes    (protected)
  ├── /api/v1/channel-groups → groupRoutes    (protected)
  │
  ├── /health               → healthCheck     (public)
  │
  ├── Middleware: notFoundHandler
  └── Middleware: errorHandler
```

Follows the fullstack-template 4-layer pattern: **Route → Controller → Service → Database**.

---

## Authentication

From fullstack-template patterns. JWT + sessions.

### Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Login with username/password |
| POST | `/api/v1/auth/logout` | Invalidate session |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/auth/me` | Get current user |

### Token Flow

1. Login: validate credentials → create session → return `{ accessToken, refreshToken }`
2. Access token: JWT, 15min TTL, contains `{ userId, sessionId, permissions }`
3. Refresh token: JWT, 7 days TTL, hashed and stored in `sessions` table
4. Auth middleware: check `Authorization: Bearer <token>` header, verify JWT, load user

### Key Differences from Connect

| Aspect | Connect | Mirthless |
|---|---|---|
| Auth | Session cookies + Basic Auth | JWT + refresh tokens |
| RBAC | Always-true default (commercial plugin) | Built-in roles + permissions |
| Password storage | Custom Digester | bcrypt (12 rounds) |
| Rate limiting | None | express-rate-limit on auth endpoints |
| MFA | Commercial plugin | Built-in (TOTP via otpauth) |

---

## Authorization (RBAC)

Built-in from day one. Not a commercial add-on.

### Permissions Model

```typescript
// Resource + Action + Scope
interface Permission {
  resource: 'channels' | 'messages' | 'users' | 'config' | 'alerts' | 'code-templates' | 'events' | 'system';
  action: 'read' | 'write' | 'deploy' | 'delete' | 'admin';
  scope: 'all' | ReadonlyArray<ChannelId>; // Channel-scoped permissions
}
```

### Default Roles

| Role | Permissions |
|---|---|
| `admin` | All resources, all actions, all channels |
| `deployer` | channels:read+write+deploy, messages:read, code-templates:read+write |
| `developer` | channels:read+write (scoped), messages:read (scoped), code-templates:read+write |
| `viewer` | channels:read (scoped), messages:read (scoped) |

### Middleware

```typescript
// Route-level permission check
router.put('/channels/:id',
  authMiddleware,
  requirePermission('channels', 'write'),
  channelController.update,
);

// Channel-scoped permission check
router.get('/channels/:id/messages',
  authMiddleware,
  requireChannelAccess('read'),
  messageController.search,
);
```

---

## API Endpoints

### Channels

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/channels` | List channels (filtered by user access) | channels:read |
| POST | `/channels` | Create channel | channels:write |
| GET | `/channels/:id` | Get channel by ID | channels:read |
| PUT | `/channels/:id` | Update channel (optimistic locking via revision) | channels:write |
| DELETE | `/channels/:id` | Delete channel | channels:delete |
| PATCH | `/channels/:id/enabled` | Enable/disable | channels:write |
| GET | `/channels/:id/status` | Get runtime status | channels:read |
| POST | `/channels/:id/deploy` | Deploy channel | channels:deploy |
| POST | `/channels/:id/undeploy` | Undeploy channel | channels:deploy |
| POST | `/channels/:id/start` | Start channel | channels:deploy |
| POST | `/channels/:id/stop` | Stop channel | channels:deploy |
| POST | `/channels/:id/pause` | Pause channel | channels:deploy |
| POST | `/channels/:id/resume` | Resume channel | channels:deploy |
| GET | `/channels/:id/statistics` | Get statistics | channels:read |
| DELETE | `/channels/:id/statistics` | Clear statistics | channels:write |
| GET | `/channels/summary` | Diff sync (client sends cache, server returns changes) | channels:read |
| POST | `/channels/deploy` | Bulk deploy | channels:deploy |
| POST | `/channels/undeploy` | Bulk undeploy | channels:deploy |

### Messages

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/channels/:id/messages` | Search messages (filter, paginate) | messages:read |
| GET | `/channels/:id/messages/count` | Count matching messages | messages:read |
| GET | `/channels/:id/messages/:msgId` | Get message with content | messages:read |
| POST | `/channels/:id/messages` | Process (inject) a new message | messages:write |
| POST | `/channels/:id/messages/:msgId/reprocess` | Reprocess message | messages:write |
| DELETE | `/channels/:id/messages/:msgId` | Delete message | messages:delete |
| DELETE | `/channels/:id/messages` | Bulk delete (with filter) | messages:delete |
| GET | `/channels/:id/messages/:msgId/attachments` | Get attachments | messages:read |

### Code Templates

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/code-templates/libraries` | List libraries | code-templates:read |
| POST | `/code-templates/libraries` | Create library | code-templates:write |
| PUT | `/code-templates/libraries/:id` | Update library | code-templates:write |
| DELETE | `/code-templates/libraries/:id` | Delete library | code-templates:delete |
| GET | `/code-templates` | List templates | code-templates:read |
| POST | `/code-templates` | Create template | code-templates:write |
| PUT | `/code-templates/:id` | Update template | code-templates:write |
| DELETE | `/code-templates/:id` | Delete template | code-templates:delete |

### Resources

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/resources` | List resources | config:read |
| POST | `/resources` | Upload resource file | config:write |
| GET | `/resources/:id` | Download resource file | config:read |
| PUT | `/resources/:id` | Replace resource file | config:write |
| DELETE | `/resources/:id` | Delete resource | config:delete |

### Extensions (Plugin Management)

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/extensions` | List installed plugins | system:read |
| GET | `/extensions/:id` | Get plugin details and status | system:read |
| PATCH | `/extensions/:id/enabled` | Enable/disable plugin | system:admin |

### System

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/system/info` | Server version, Node.js version, uptime, memory, DB pool status | system:read |
| GET | `/system/backup` | Export full server config as JSON | system:admin |
| POST | `/system/restore` | Import server config from JSON | system:admin |
| GET | `/system/logs` | Get recent server logs (paginated) | system:read |
| GET | `/system/pruner/status` | Get data pruner status and last run | system:read |
| POST | `/system/pruner/run` | Trigger data pruner manually | system:admin |

### Global Map

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/global-map` | List all global map entries | config:read |
| GET | `/global-map/:key` | Get global map value | config:read |
| PUT | `/global-map/:key` | Set global map value | config:write |
| DELETE | `/global-map/:key` | Delete global map entry | config:write |
| DELETE | `/global-map` | Clear all global map entries | config:admin |

### Configuration Map

| Method | Path | Description | Permissions |
|---|---|---|---|
| GET | `/config-map` | List all config map entries | config:read |
| PUT | `/config-map` | Set config map entries (bulk) | config:admin |

### Users, Alerts, Config, Events

Standard CRUD following the same patterns. See architecture overview for full endpoint list.

---

## Response Format

All responses follow the fullstack-template pattern:

```typescript
// Success
{ "success": true, "data": T }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Channel not found", "details": {} } }

// Paginated
{ "success": true, "data": T[], "pagination": { "total": 100, "offset": 0, "limit": 25 } }
```

---

## Server Startup Sequence

```
1. Load environment config (Zod-validated)
2. Initialize database connection (Drizzle + pg pool)
3. Run database migrations (drizzle-kit)
4. Initialize services (DI — constructor injection)
5. Initialize Express app + middleware
6. Mount routes
7. Start HTTP server
8. Initialize engine (Donkey equivalent)
9. Load and compile global scripts
10. Deploy channels (startup deploy, respecting dependency DAG)
11. Set status = READY
12. Log startup complete
```

### Graceful Shutdown

```
SIGTERM/SIGINT received
1. Stop accepting new HTTP connections
2. Undeploy all channels (stop source connectors, drain queues)
3. Close engine
4. Close database pool
5. Exit
```

Timeout: 30s. If not complete, force exit.

---

## Deployment Orchestration

Channel dependencies form a DAG. Deploy order respects dependencies.

```typescript
class DeploymentService {
  async deployChannels(channelIds: ReadonlyArray<ChannelId>): Promise<Result<DeployReport>> {
    // 1. Load channel configs
    const channels = await this.channelService.getByIds(channelIds);

    // 2. Build dependency graph
    const deps = await this.channelService.getDependencies();
    const graph = buildDependencyGraph(channels, deps);

    // 3. Compute deployment tiers
    const tiers = graph.topologicalTiers(); // [[tier0], [tier1], ...]

    // 4. Deploy tier by tier (within each tier, parallel)
    const errors: DeployError[] = [];
    for (const tier of tiers) {
      const results = await Promise.allSettled(
        tier.map(id => this.engine.deployChannel(id))
      );
      // Collect errors but continue
    }

    return { ok: true, value: { deployed: channelIds.length - errors.length, errors } };
  }
}
```

---

## Configuration Management

Connect stores config as key-value pairs in a `CONFIGURATION` table. We keep this simple approach for server settings, but use proper tables for structured data.

```typescript
// Server settings (key-value)
interface ConfigService {
  get(key: string): Promise<Result<string | null>>;
  set(key: string, value: string): Promise<Result<void>>;
  getServerSettings(): Promise<Result<ServerSettings>>;
  setServerSettings(settings: ServerSettings): Promise<Result<void>>;
}
```

---

## Resolved Decisions

1. **Real-time: Socket.IO** — Use Socket.IO for live channel status, statistics updates, and log streaming. TanStack Query polling as fallback. See `00-architecture-overview.md` Resolved Decision #4.

2. **API versioning: URL-based (`/api/v1`)** — Start with `/api/v1` URL prefix. URL versioning is simple, explicit, and the industry standard for REST APIs. No header versioning — it adds complexity with no real benefit at this scale. Introduce `/api/v2` only when breaking changes are unavoidable; prefer additive (non-breaking) changes to existing endpoints.

3. **No diff sync for channels** — Skip the `getChannelSummary` diff sync pattern. TanStack Query handles client-side caching and invalidation natively. The server returns full channel data; the client's query cache avoids redundant re-renders. This is simpler and aligns with modern web patterns.

4. **Server backup/restore: JSON export/import** — Support full server configuration export as a single JSON file (channels, code templates, alerts, global scripts, users, settings) and import to restore. Endpoints: `GET /api/v1/system/backup` and `POST /api/v1/system/restore`. Import validates all entities with Zod before applying. Useful for disaster recovery, environment promotion (dev → staging → prod), and migration.
