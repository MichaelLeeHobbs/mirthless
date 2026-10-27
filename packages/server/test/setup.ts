// ===========================================
// Test Setup — Environment Variables
// ===========================================

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://galvaniflow:galvaniflow_dev@localhost:5432/galvaniflow_test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long';
process.env.LOG_LEVEL = 'error';
process.env.FRONTEND_URL = 'http://localhost:5173';
