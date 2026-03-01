// ===========================================
// E2E Test Constants
// ===========================================

/** Default admin credentials seeded by db:seed */
export const ADMIN_USER = {
  username: 'admin',
  password: 'Admin123!',
} as const;

/** Test channel constants */
export const TEST_CHANNEL = {
  name: 'E2E Test Channel',
  description: 'Created by Playwright E2E tests',
  sourcePort: 18661,
  destPort: 18662,
} as const;

/** Test user constants */
export const TEST_USER = {
  username: 'e2e-test-user',
  email: 'e2e@test.local',
  password: 'TestPass123!',
  firstName: 'E2E',
  lastName: 'Tester',
} as const;

/** Test code template constants */
export const TEST_LIBRARY = {
  name: 'E2E Test Library',
  description: 'Created by Playwright E2E tests',
} as const;

export const TEST_TEMPLATE = {
  name: 'e2eHelper',
  code: 'function e2eHelper() { return true; }',
} as const;

/** Test alert constants */
export const TEST_ALERT = {
  name: 'E2E Test Alert',
  description: 'Alert created by E2E test',
} as const;
