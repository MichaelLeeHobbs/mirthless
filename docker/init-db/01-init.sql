-- Create test database for running tests
-- Runs as POSTGRES_USER on the volume's first start, so CURRENT_USER is the app user.
CREATE DATABASE galvaniflow_test;
GRANT ALL PRIVILEGES ON DATABASE galvaniflow_test TO CURRENT_USER;
