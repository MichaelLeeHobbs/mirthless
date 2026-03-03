// ===========================================
// OpenAPI 3.1 Specification
// ===========================================
// Generates the OpenAPI spec object for Swagger UI.
// Documents key API endpoints across 8 tag groups.

/** OpenAPI spec type — minimal structural typing for the spec object. */
interface OpenAPISpec {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
    readonly license: { readonly name: string; readonly url: string };
  };
  readonly servers: ReadonlyArray<{ readonly url: string; readonly description: string }>;
  readonly tags: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
  };
}

/** Standard success response wrapper. */
function successResponse(description: string, dataSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: dataSchema,
          },
        },
      },
    },
  };
}

/** Standard error response reference. */
function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  };
}

/** Bearer auth security requirement. */
const bearerSecurity = [{ bearerAuth: [] }];

/** 204 No Content response. */
const noContent: Record<string, unknown> = { description: 'No content' };

/**
 * Generates the complete OpenAPI 3.1 specification for the Mirthless API.
 * @returns The OpenAPI spec as a plain object.
 */
export function generateOpenAPISpec(): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mirthless API',
      version: '0.0.1',
      description: 'Healthcare integration engine API — message routing and transformation for HL7v2, FHIR, DICOM, and more.',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      { url: '/api/v1', description: 'API v1' },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and session management' },
      { name: 'Channels', description: 'Channel CRUD operations' },
      { name: 'Deployment', description: 'Channel deployment and lifecycle control' },
      { name: 'Messages', description: 'Message search and detail retrieval' },
      { name: 'Users', description: 'User management' },
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Events', description: 'System event log' },
      { name: 'Settings', description: 'Server settings management' },
    ],
    paths: {
      // ===================== Auth =====================
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with username and password',
          operationId: 'authLogin',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string', minLength: 1 },
                    password: { type: 'string', minLength: 1 },
                  },
                },
              },
            },
          },
          responses: {
            '200': successResponse('Login successful', {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                user: { $ref: '#/components/schemas/User' },
              },
            }),
            '401': errorResponse('Invalid credentials'),
            '429': errorResponse('Too many login attempts'),
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token using refresh cookie',
          operationId: 'authRefresh',
          responses: {
            '200': successResponse('Token refreshed', {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
              },
            }),
            '401': errorResponse('Invalid or expired refresh token'),
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout and invalidate session',
          operationId: 'authLogout',
          security: bearerSecurity,
          responses: {
            '204': noContent,
            '401': errorResponse('Not authenticated'),
          },
        },
      },

      // ===================== Channels =====================
      '/channels': {
        get: {
          tags: ['Channels'],
          summary: 'List all channels',
          operationId: 'channelList',
          security: bearerSecurity,
          parameters: [
            { name: 'enabled', in: 'query', schema: { type: 'boolean' }, description: 'Filter by enabled state' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Page size' },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Page offset' },
          ],
          responses: {
            '200': successResponse('Channel list', {
              type: 'object',
              properties: {
                channels: { type: 'array', items: { $ref: '#/components/schemas/Channel' } },
                total: { type: 'integer' },
              },
            }),
            '401': errorResponse('Not authenticated'),
          },
        },
        post: {
          tags: ['Channels'],
          summary: 'Create a new channel',
          operationId: 'channelCreate',
          security: bearerSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateChannel' },
              },
            },
          },
          responses: {
            '201': successResponse('Channel created', { $ref: '#/components/schemas/Channel' }),
            '400': errorResponse('Validation error'),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
      },
      '/channels/{id}': {
        get: {
          tags: ['Channels'],
          summary: 'Get channel by ID',
          operationId: 'channelGetById',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel details', { $ref: '#/components/schemas/Channel' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
        put: {
          tags: ['Channels'],
          summary: 'Update a channel',
          operationId: 'channelUpdate',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateChannel' },
              },
            },
          },
          responses: {
            '200': successResponse('Channel updated', { $ref: '#/components/schemas/Channel' }),
            '400': errorResponse('Validation error'),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
        delete: {
          tags: ['Channels'],
          summary: 'Delete a channel',
          operationId: 'channelDelete',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '204': noContent,
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/clone': {
        post: {
          tags: ['Channels'],
          summary: 'Clone a channel',
          operationId: 'channelClone',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', minLength: 1, maxLength: 255 },
                  },
                },
              },
            },
          },
          responses: {
            '201': successResponse('Channel cloned', { $ref: '#/components/schemas/Channel' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Source channel not found'),
          },
        },
      },
      '/channels/{id}/enabled': {
        patch: {
          tags: ['Channels'],
          summary: 'Set channel enabled state',
          operationId: 'channelSetEnabled',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['enabled'],
                  properties: {
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': successResponse('Channel enabled state updated', { $ref: '#/components/schemas/Channel' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/import/mirth': {
        post: {
          tags: ['Channels'],
          summary: 'Import channel from Mirth Connect XML',
          operationId: 'channelImportMirth',
          security: bearerSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['xml'],
                  properties: {
                    xml: { type: 'string', description: 'Mirth Connect channel XML' },
                  },
                },
              },
            },
          },
          responses: {
            '201': successResponse('Channel imported', { $ref: '#/components/schemas/Channel' }),
            '400': errorResponse('Invalid Mirth XML'),
            '401': errorResponse('Not authenticated'),
          },
        },
      },

      // ===================== Deployment =====================
      '/channels/{id}/deploy': {
        post: {
          tags: ['Deployment'],
          summary: 'Deploy a channel',
          operationId: 'channelDeploy',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel deployed', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
            '409': errorResponse('Channel already deployed'),
          },
        },
      },
      '/channels/{id}/undeploy': {
        post: {
          tags: ['Deployment'],
          summary: 'Undeploy a channel',
          operationId: 'channelUndeploy',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel undeployed', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/start': {
        post: {
          tags: ['Deployment'],
          summary: 'Start a deployed channel',
          operationId: 'channelStart',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel started', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
            '409': errorResponse('Channel not deployed'),
          },
        },
      },
      '/channels/{id}/stop': {
        post: {
          tags: ['Deployment'],
          summary: 'Stop a running channel',
          operationId: 'channelStop',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel stopped', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/pause': {
        post: {
          tags: ['Deployment'],
          summary: 'Pause a running channel',
          operationId: 'channelPause',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel paused', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/halt': {
        post: {
          tags: ['Deployment'],
          summary: 'Halt a channel immediately',
          operationId: 'channelHalt',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel halted', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/resume': {
        post: {
          tags: ['Deployment'],
          summary: 'Resume a paused channel',
          operationId: 'channelResume',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel resumed', { type: 'object', properties: { state: { type: 'string' } } }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/status': {
        get: {
          tags: ['Deployment'],
          summary: 'Get deployment status of all channels',
          operationId: 'channelStatusAll',
          security: bearerSecurity,
          responses: {
            '200': successResponse('All channel statuses', {
              type: 'array',
              items: { $ref: '#/components/schemas/ChannelStatus' },
            }),
            '401': errorResponse('Not authenticated'),
          },
        },
      },
      '/channels/{id}/status': {
        get: {
          tags: ['Deployment'],
          summary: 'Get deployment status of a specific channel',
          operationId: 'channelStatusById',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('Channel status', { $ref: '#/components/schemas/ChannelStatus' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },

      // ===================== Messages =====================
      '/channels/{id}/messages': {
        get: {
          tags: ['Messages'],
          summary: 'Search messages for a channel',
          operationId: 'messageSearch',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by message status' },
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start of date range' },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End of date range' },
            { name: 'textSearch', in: 'query', schema: { type: 'string' }, description: 'Full-text search in content' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Page size' },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Page offset' },
          ],
          responses: {
            '200': successResponse('Message search results', {
              type: 'object',
              properties: {
                messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } },
                total: { type: 'integer' },
              },
            }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/messages/{msgId}': {
        get: {
          tags: ['Messages'],
          summary: 'Get message detail',
          operationId: 'messageGetDetail',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'msgId', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '200': successResponse('Message detail', { $ref: '#/components/schemas/MessageDetail' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Message not found'),
          },
        },
        delete: {
          tags: ['Messages'],
          summary: 'Delete a message',
          operationId: 'messageDelete',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'msgId', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '204': noContent,
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Message not found'),
          },
        },
      },

      // ===================== Users =====================
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List all users',
          operationId: 'userList',
          security: bearerSecurity,
          responses: {
            '200': successResponse('User list', {
              type: 'array',
              items: { $ref: '#/components/schemas/User' },
            }),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
        post: {
          tags: ['Users'],
          summary: 'Create a new user',
          operationId: 'userCreate',
          security: bearerSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateUser' },
              },
            },
          },
          responses: {
            '201': successResponse('User created', { $ref: '#/components/schemas/User' }),
            '400': errorResponse('Validation error'),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
            '409': errorResponse('Username already exists'),
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get user by ID',
          operationId: 'userGetById',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('User details', { $ref: '#/components/schemas/User' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('User not found'),
          },
        },
        put: {
          tags: ['Users'],
          summary: 'Update a user',
          operationId: 'userUpdate',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateUser' },
              },
            },
          },
          responses: {
            '200': successResponse('User updated', { $ref: '#/components/schemas/User' }),
            '400': errorResponse('Validation error'),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('User not found'),
          },
        },
        delete: {
          tags: ['Users'],
          summary: 'Delete a user',
          operationId: 'userDelete',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '204': noContent,
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('User not found'),
          },
        },
      },
      '/users/{id}/password': {
        post: {
          tags: ['Users'],
          summary: 'Change user password',
          operationId: 'userChangePassword',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['newPassword'],
                  properties: {
                    currentPassword: { type: 'string', description: 'Current password (required for non-admin)' },
                    newPassword: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            '204': noContent,
            '400': errorResponse('Validation error'),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
      },
      '/users/{id}/unlock': {
        post: {
          tags: ['Users'],
          summary: 'Unlock a locked user account',
          operationId: 'userUnlock',
          security: bearerSecurity,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': successResponse('User unlocked', { $ref: '#/components/schemas/User' }),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
            '404': errorResponse('User not found'),
          },
        },
      },

      // ===================== Health =====================
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Full health check (database, memory, engine)',
          operationId: 'healthFull',
          responses: {
            '200': {
              description: 'System healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthStatus' },
                },
              },
            },
            '503': {
              description: 'System unhealthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthStatus' },
                },
              },
            },
          },
        },
      },
      '/health/live': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe',
          operationId: 'healthLive',
          responses: {
            '200': {
              description: 'Server is alive',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { status: { type: 'string', enum: ['ok'] } },
                  },
                },
              },
            },
          },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe (checks database)',
          operationId: 'healthReady',
          responses: {
            '200': {
              description: 'Server is ready',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok'] },
                      database: {
                        type: 'object',
                        properties: { connected: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Server not ready',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['unavailable'] },
                      database: {
                        type: 'object',
                        properties: { connected: { type: 'boolean' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ===================== Events =====================
      '/events': {
        get: {
          tags: ['Events'],
          summary: 'List events with filtering',
          operationId: 'eventList',
          security: bearerSecurity,
          parameters: [
            { name: 'level', in: 'query', schema: { type: 'string' }, description: 'Filter by event level' },
            { name: 'name', in: 'query', schema: { type: 'string' }, description: 'Filter by event name' },
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start of date range' },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End of date range' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Page size' },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Page offset' },
          ],
          responses: {
            '200': successResponse('Event list', {
              type: 'object',
              properties: {
                events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
                total: { type: 'integer' },
              },
            }),
            '401': errorResponse('Not authenticated'),
          },
        },
        delete: {
          tags: ['Events'],
          summary: 'Purge events',
          operationId: 'eventPurge',
          security: bearerSecurity,
          parameters: [
            { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Purge events before this date' },
          ],
          responses: {
            '200': successResponse('Events purged', {
              type: 'object',
              properties: { deleted: { type: 'integer' } },
            }),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
      },
      '/events/export': {
        get: {
          tags: ['Events'],
          summary: 'Export events as CSV or JSON',
          operationId: 'eventExport',
          security: bearerSecurity,
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'] }, description: 'Export format' },
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start of date range' },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End of date range' },
          ],
          responses: {
            '200': {
              description: 'Exported events',
              content: {
                'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Event' } } },
                'text/csv': { schema: { type: 'string' } },
              },
            },
            '401': errorResponse('Not authenticated'),
          },
        },
      },

      // ===================== Settings =====================
      '/settings': {
        get: {
          tags: ['Settings'],
          summary: 'List all settings',
          operationId: 'settingList',
          security: bearerSecurity,
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' }, description: 'Filter by category' },
          ],
          responses: {
            '200': successResponse('Settings list', {
              type: 'array',
              items: { $ref: '#/components/schemas/Setting' },
            }),
            '401': errorResponse('Not authenticated'),
          },
        },
      },
      '/settings/bulk': {
        put: {
          tags: ['Settings'],
          summary: 'Bulk upsert settings',
          operationId: 'settingBulkUpsert',
          security: bearerSecurity,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/UpsertSetting' },
                },
              },
            },
          },
          responses: {
            '200': successResponse('Settings updated', {
              type: 'array',
              items: { $ref: '#/components/schemas/Setting' },
            }),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
      },
      '/settings/{key}': {
        get: {
          tags: ['Settings'],
          summary: 'Get a setting by key',
          operationId: 'settingGetByKey',
          security: bearerSecurity,
          parameters: [
            { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': successResponse('Setting value', { $ref: '#/components/schemas/Setting' }),
            '401': errorResponse('Not authenticated'),
            '404': errorResponse('Setting not found'),
          },
        },
        put: {
          tags: ['Settings'],
          summary: 'Create or update a setting',
          operationId: 'settingUpsert',
          security: bearerSecurity,
          parameters: [
            { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpsertSetting' },
              },
            },
          },
          responses: {
            '200': successResponse('Setting saved', { $ref: '#/components/schemas/Setting' }),
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
        delete: {
          tags: ['Settings'],
          summary: 'Delete a setting',
          operationId: 'settingDelete',
          security: bearerSecurity,
          parameters: [
            { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': noContent,
            '401': errorResponse('Not authenticated'),
            '403': errorResponse('Insufficient permissions'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token from /auth/login',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', description: 'Machine-readable error code' },
                message: { type: 'string', description: 'Human-readable error message' },
                details: { description: 'Additional error context' },
              },
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'deployer', 'developer', 'viewer'] },
            enabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateUser: {
          type: 'object',
          required: ['username', 'password', 'role'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 50 },
            password: { type: 'string', minLength: 8 },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'deployer', 'developer', 'viewer'] },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        UpdateUser: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'deployer', 'developer', 'viewer'] },
            enabled: { type: 'boolean' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        Channel: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            enabled: { type: 'boolean' },
            revision: { type: 'integer' },
            sourceConnector: { type: 'object', description: 'Source connector configuration' },
            destinationConnectors: { type: 'array', items: { type: 'object' }, description: 'Destination connector configurations' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateChannel: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string' },
            sourceConnector: { type: 'object', description: 'Source connector configuration' },
            destinationConnectors: { type: 'array', items: { type: 'object' } },
          },
        },
        UpdateChannel: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string' },
            enabled: { type: 'boolean' },
            revision: { type: 'integer', description: 'Required for optimistic locking' },
            sourceConnector: { type: 'object' },
            destinationConnectors: { type: 'array', items: { type: 'object' } },
          },
        },
        ChannelStatus: {
          type: 'object',
          properties: {
            channelId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            state: { type: 'string', enum: ['UNDEPLOYED', 'STARTED', 'PAUSED', 'STOPPED'] },
            deployedRevision: { type: 'integer' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            channelId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            receivedDate: { type: 'string', format: 'date-time' },
          },
        },
        MessageDetail: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            channelId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            rawContent: { type: 'string' },
            transformedContent: { type: 'string' },
            connectorMessages: { type: 'array', items: { type: 'object' } },
            receivedDate: { type: 'string', format: 'date-time' },
          },
        },
        Event: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            level: { type: 'string' },
            message: { type: 'string' },
            userId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Setting: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            category: { type: 'string' },
          },
        },
        UpsertSetting: {
          type: 'object',
          required: ['value'],
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            category: { type: 'string' },
          },
        },
        HealthStatus: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'unavailable'] },
            database: { type: 'object', properties: { connected: { type: 'boolean' } } },
            memory: { type: 'object', properties: { heapUsedMB: { type: 'number' }, heapTotalMB: { type: 'number' } } },
            engine: { type: 'object', properties: { deployedChannels: { type: 'integer' } } },
          },
        },
      },
    },
  };
}
