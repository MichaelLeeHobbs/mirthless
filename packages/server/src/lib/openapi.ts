// ===========================================
// OpenAPI 3.1 Specification
// ===========================================
// Generates the OpenAPI spec object for Swagger UI.
// Documents key API endpoints across 8 tag groups.

import { MAX_ASSIGNMENTS_PER_USER, SET_CHANNEL_GROUPS_MAX } from '@galvanigraph/core-models';

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

/** The optional group a new channel joins (D-310). */
const NEW_CHANNEL_GROUP = {
  type: 'string', format: 'uuid',
  description: 'The channel group new channels join; needs channels:write in it. Without it: Default for a caller who can change every channel, else their only such group.',
} as const;

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
function openApiErrorResponse(description: string): Record<string, unknown> {
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
 * Generates the complete OpenAPI 3.1 specification for the GalvaniGraph API.
 * @returns The OpenAPI spec as a plain object.
 */
export function generateOpenAPISpec(): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: {
      title: 'GalvaniGraph API',
      version: '0.1.0',
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
            '401': openApiErrorResponse('Invalid credentials'),
            '429': openApiErrorResponse('Too many login attempts'),
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token using refresh cookie',
          operationId: 'authRefresh',
          responses: {
            '200': successResponse('Token refreshed, with the user and their current permissions', {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                user: { $ref: '#/components/schemas/User' },
              },
            }),
            '401': openApiErrorResponse('Invalid or expired refresh token'),
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
            '401': openApiErrorResponse('Not authenticated'),
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
            '401': openApiErrorResponse('Not authenticated'),
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
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
                    groupId: NEW_CHANNEL_GROUP,
                  },
                },
              },
            },
          },
          responses: {
            '201': successResponse('Channel cloned', { $ref: '#/components/schemas/Channel' }),
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Source channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
          },
        },
      },
      '/channels/{id}/groups': {
        put: {
          tags: ['Channels'],
          summary: 'Set the groups a channel belongs to',
          description: 'Replaces every group membership the channel has with the listed groups, in one transaction. An empty list takes the channel out of every group. Needs channels:write.',
          operationId: 'channelSetGroups',
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
                  required: ['groupIds'],
                  properties: {
                    groupIds: { type: 'array', uniqueItems: true, maxItems: SET_CHANNEL_GROUPS_MAX, items: { type: 'string', format: 'uuid' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': successResponse('Channel groups set', {
              type: 'object',
              properties: {
                channelId: { type: 'string', format: 'uuid' },
                groupIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
              },
            }),
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Missing channels:write'),
            '404': openApiErrorResponse('Channel or group not found'),
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
                    groupId: NEW_CHANNEL_GROUP,
                  },
                },
              },
            },
          },
          responses: {
            '201': successResponse('Channel imported', { $ref: '#/components/schemas/Channel' }),
            '400': openApiErrorResponse('Invalid Mirth XML'),
            '401': openApiErrorResponse('Not authenticated'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
            '409': openApiErrorResponse('Channel already deployed'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
            '409': openApiErrorResponse('Channel not deployed'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Channel not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Message not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Message not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
            '409': openApiErrorResponse('Username already exists'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('User not found'),
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
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('User not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('User not found'),
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
            '400': openApiErrorResponse('Validation error'),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
          },
        },
      },
      '/users/{id}/assignments': {
        get: {
          tags: ['Users'],
          summary: "List a user's assignments, live and expired",
          operationId: 'userListAssignments',
          security: bearerSecurity,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': successResponse('Assignments', { type: 'array', items: { $ref: '#/components/schemas/Assignment' } }),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Missing users:read'),
            '404': openApiErrorResponse('User not found'),
          },
        },
        put: {
          tags: ['Users'],
          summary: "Replace a user's assignments",
          description: 'Each assignment gives a role on every channel (groupIds null) or on a set of channel groups, with an optional expiry and reason. Needs users:write, and every permission of each role over its scope. A role holding a permission limited to all-channel assignments cannot be given on groups; the Default group cannot be a scope; nobody changes their own access.',
          operationId: 'userSetAssignments',
          security: bearerSecurity,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['assignments'],
                  properties: {
                    assignments: {
                      type: 'array', maxItems: MAX_ASSIGNMENTS_PER_USER,
                      items: {
                        type: 'object',
                        required: ['roleId', 'groupIds'],
                        properties: {
                          roleId: { type: 'string', format: 'uuid' },
                          groupIds: { type: ['array', 'null'], items: { type: 'string', format: 'uuid' }, description: 'null: every channel' },
                          expiresAt: { type: ['string', 'null'], format: 'date-time' },
                          reason: { type: ['string', 'null'], maxLength: 500 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': successResponse('Assignments after the change', { type: 'array', items: { $ref: '#/components/schemas/Assignment' } }),
            '400': openApiErrorResponse('A scope the role cannot have, the Default group, or an expiry in the past'),
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Your own access, a user you cannot manage, or a role you do not hold over the scope'),
            '404': openApiErrorResponse('User, role or group not found'),
            '409': openApiErrorResponse('Would leave no lasting admin'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
            '404': openApiErrorResponse('User not found'),
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
              description: 'System healthy, or `degraded` because a startup step failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthStatus' },
                },
              },
            },
            '503': {
              description: 'Database unreachable (`degraded`)',
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
          summary: 'Readiness probe (checks database and startup steps)',
          operationId: 'healthReady',
          responses: {
            '200': {
              description: 'Server is ready. `degraded` when a startup step failed; `startup.failedSteps` names it',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['ok', 'degraded'] },
                      database: {
                        type: 'object',
                        properties: { connected: { type: 'boolean' } },
                      },
                      startup: {
                        type: 'object',
                        properties: { failedSteps: { type: 'array', items: { type: 'string', enum: ['queue', 'pruner-scheduler', 'channel-redeploy', 'audit-partitions'] } } },
                      },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Server not ready (database unreachable)',
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
                      startup: {
                        type: 'object',
                        properties: { failedSteps: { type: 'array', items: { type: 'string' } } },
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
            '401': openApiErrorResponse('Not authenticated'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            { name: 'reason', in: 'query', required: true, schema: { type: 'string', minLength: 3, maxLength: 500 }, description: 'Why the export is taken (one line). Recorded in the audit log and written into the file.' },
          ],
          responses: {
            '200': {
              description: 'Exported events. A CSV starts with "# " header lines; JSON wraps the rows. Both name the audit record and the reason (D-318).',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      export: { type: 'object', description: 'server, exportedBy, exportedAt, auditRecordId, reason' },
                      events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
                    },
                  },
                },
                'text/csv': { schema: { type: 'string' } },
              },
            },
            '400': openApiErrorResponse('Missing or invalid reason'),
            '401': openApiErrorResponse('Not authenticated'),
            '503': openApiErrorResponse('AUDIT_UNAVAILABLE: the export could not be recorded, so nothing was exported'),
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
            '401': openApiErrorResponse('Not authenticated'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '404': openApiErrorResponse('Setting not found'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            '401': openApiErrorResponse('Not authenticated'),
            '403': openApiErrorResponse('Insufficient permissions'),
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
            role: { type: 'string', description: 'The names of the roles the user holds, joined' },
            roles: { type: 'array', items: { type: 'string' }, description: 'The names of the roles the user holds' },
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
            role: { type: 'string', description: 'The name of a role; the user gets one all-channel assignment of it' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        UpdateUser: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', description: 'The name of a role; the user gets one all-channel assignment of it' },
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
            groupId: NEW_CHANNEL_GROUP,
          },
        },
        Assignment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            roleId: { type: 'string', format: 'uuid' },
            roleName: { type: 'string' },
            groupIds: { type: ['array', 'null'], items: { type: 'string', format: 'uuid' }, description: 'null: every channel' },
            expiresAt: { type: ['string', 'null'], format: 'date-time' },
            reason: { type: ['string', 'null'] },
            live: { type: 'boolean', description: 'Not yet expired' },
            createdAt: { type: 'string', format: 'date-time' },
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
            startup: {
              type: 'object',
              description: 'Startup steps that failed (queue, pruner-scheduler, channel-redeploy). Any failure makes the status degraded.',
              properties: {
                failed: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { step: { type: 'string' }, errMsg: { type: 'string' }, failedAt: { type: 'string', format: 'date-time' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
