// Seeded by db:seed.
export const ADMIN_USER = {
  username: 'admin',
  password: 'Admin123!',
} as const;

export const TEST_CHANNEL = {
  name: 'E2E Test Channel',
  description: 'Created by Playwright E2E tests',
  sourcePort: 18661,
  destPort: 18662,
} as const;

// channel-deploy.spec.ts only; no other spec uses its port.
export const DEPLOY_CHANNEL = {
  name: 'E2E Deploy Channel',
  sourcePort: 18671,
} as const;

export const TEST_USER = {
  username: 'e2e-test-user',
  email: 'e2e@test.local',
  password: 'TestPass123!',
  firstName: 'E2E',
  lastName: 'Tester',
} as const;

export const TEST_LIBRARY = {
  name: 'E2E Test Library',
  description: 'Created by Playwright E2E tests',
} as const;

export const TEST_TEMPLATE = {
  name: 'e2eHelper',
  code: 'function e2eHelper() { return true; }',
} as const;

export const TEST_ALERT = {
  name: 'E2E Test Alert',
  description: 'Alert created by E2E test',
} as const;
