import { describe, it, expect } from 'vitest';
import { generateOpenAPISpec } from '../openapi.js';

describe('generateOpenAPISpec', () => {
  const spec = generateOpenAPISpec();

  it('returns a valid OpenAPI 3.1 structure', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('Mirthless API');
    expect(spec.info.version).toBe('0.0.1');
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
  });

  it('defines all 8 tag groups', () => {
    const tagNames = spec.tags.map((t) => t.name);
    expect(tagNames).toContain('Auth');
    expect(tagNames).toContain('Channels');
    expect(tagNames).toContain('Deployment');
    expect(tagNames).toContain('Messages');
    expect(tagNames).toContain('Users');
    expect(tagNames).toContain('Health');
    expect(tagNames).toContain('Events');
    expect(tagNames).toContain('Settings');
    expect(tagNames).toHaveLength(8);
  });

  it('documents at least 37 path+method combinations', () => {
    let operationCount = 0;
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const pathObj of Object.values(spec.paths)) {
      for (const method of methods) {
        if (method in pathObj) {
          operationCount++;
        }
      }
    }
    expect(operationCount).toBeGreaterThanOrEqual(37);
  });

  it('contains expected auth endpoints', () => {
    expect(spec.paths['/auth/login']).toBeDefined();
    expect(spec.paths['/auth/refresh']).toBeDefined();
    expect(spec.paths['/auth/logout']).toBeDefined();
  });

  it('contains expected channel endpoints', () => {
    expect(spec.paths['/channels']).toBeDefined();
    expect(spec.paths['/channels/{id}']).toBeDefined();
    expect(spec.paths['/channels/{id}/clone']).toBeDefined();
    expect(spec.paths['/channels/import/mirth']).toBeDefined();
  });

  it('contains expected deployment endpoints', () => {
    expect(spec.paths['/channels/{id}/deploy']).toBeDefined();
    expect(spec.paths['/channels/{id}/undeploy']).toBeDefined();
    expect(spec.paths['/channels/{id}/start']).toBeDefined();
    expect(spec.paths['/channels/{id}/stop']).toBeDefined();
    expect(spec.paths['/channels/{id}/pause']).toBeDefined();
    expect(spec.paths['/channels/status']).toBeDefined();
    expect(spec.paths['/channels/{id}/status']).toBeDefined();
  });

  it('contains expected message endpoints', () => {
    expect(spec.paths['/channels/{id}/messages']).toBeDefined();
    expect(spec.paths['/channels/{id}/messages/{msgId}']).toBeDefined();
  });

  it('contains expected user endpoints', () => {
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users/{id}']).toBeDefined();
    expect(spec.paths['/users/{id}/password']).toBeDefined();
    expect(spec.paths['/users/{id}/unlock']).toBeDefined();
  });

  it('contains expected health endpoints', () => {
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/health/live']).toBeDefined();
    expect(spec.paths['/health/ready']).toBeDefined();
  });

  it('contains expected event endpoints', () => {
    expect(spec.paths['/events']).toBeDefined();
    expect(spec.paths['/events/export']).toBeDefined();
  });

  it('contains expected settings endpoints', () => {
    expect(spec.paths['/settings']).toBeDefined();
    expect(spec.paths['/settings/bulk']).toBeDefined();
    expect(spec.paths['/settings/{key}']).toBeDefined();
  });

  it('defines bearerAuth security scheme', () => {
    const scheme = spec.components.securitySchemes['bearerAuth'] as Record<string, unknown>;
    expect(scheme).toBeDefined();
    expect(scheme['type']).toBe('http');
    expect(scheme['scheme']).toBe('bearer');
    expect(scheme['bearerFormat']).toBe('JWT');
  });

  it('uses success/data format in response schemas', () => {
    const loginPost = spec.paths['/auth/login']?.['post'] as Record<string, unknown>;
    expect(loginPost).toBeDefined();

    const responses = loginPost['responses'] as Record<string, Record<string, unknown>>;
    const ok = responses['200'] as Record<string, unknown>;
    const content = ok['content'] as Record<string, Record<string, unknown>>;
    const jsonContent = content['application/json'] as Record<string, Record<string, unknown>>;
    const schema = jsonContent['schema'] as Record<string, unknown>;
    const properties = schema['properties'] as Record<string, unknown>;

    expect(properties['success']).toBeDefined();
    expect(properties['data']).toBeDefined();
  });

  it('uses ErrorResponse schema for error responses', () => {
    const errorSchema = spec.components.schemas['ErrorResponse'] as Record<string, unknown>;
    expect(errorSchema).toBeDefined();

    const properties = (errorSchema['properties'] as Record<string, unknown>);
    expect(properties['success']).toBeDefined();
    expect(properties['error']).toBeDefined();
  });

  it('references ErrorResponse in 401 responses', () => {
    const channelGet = spec.paths['/channels']?.['get'] as Record<string, unknown>;
    const responses = channelGet['responses'] as Record<string, Record<string, unknown>>;
    const unauth = responses['401'] as Record<string, unknown>;
    const content = unauth['content'] as Record<string, Record<string, unknown>>;
    const jsonContent = content['application/json'] as Record<string, Record<string, unknown>>;
    const schema = jsonContent['schema'] as Record<string, unknown>;

    expect(schema['$ref']).toBe('#/components/schemas/ErrorResponse');
  });

  it('includes component schemas for domain objects', () => {
    const schemaNames = Object.keys(spec.components.schemas);
    expect(schemaNames).toContain('User');
    expect(schemaNames).toContain('Channel');
    expect(schemaNames).toContain('Message');
    expect(schemaNames).toContain('Event');
    expect(schemaNames).toContain('Setting');
    expect(schemaNames).toContain('HealthStatus');
    expect(schemaNames).toContain('ChannelStatus');
  });

  it('defines servers array with /api/v1 base', () => {
    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0]?.url).toBe('/api/v1');
  });

  it('applies security to authenticated endpoints but not to health', () => {
    const channelGet = spec.paths['/channels']?.['get'] as Record<string, unknown>;
    expect(channelGet['security']).toBeDefined();

    const healthLive = spec.paths['/health/live']?.['get'] as Record<string, unknown>;
    expect(healthLive['security']).toBeUndefined();
  });
});
