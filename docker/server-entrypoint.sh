#!/bin/sh
# ===========================================
# Server Container Entrypoint
# ===========================================
# Runs DB migrations as the table owner (MIGRATION_DATABASE_URL), which also
# grants the server's own role (DATABASE_URL) what it needs and checks that role
# owns no application tables (D-307). Then it drops the owner's credentials from the
# environment, runs the idempotent seed and execs the server, both as the
# server's role.
# Fail-loud: any migration or role error aborts startup (set -e). The seed is
# idempotent and can be skipped with SEED_ON_START=false.

set -e

echo "[entrypoint] running database migrations..."
node packages/server/migrate.mjs

# The server never needs the owner's password: keep it out of its environment.
unset MIGRATION_DATABASE_URL POSTGRES_PASSWORD

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] running database seed (idempotent)..."
  node packages/server/dist/db/seeds/run-seed.js
else
  echo "[entrypoint] skipping seed (SEED_ON_START=${SEED_ON_START})"
fi

echo "[entrypoint] starting server..."
exec "$@"
