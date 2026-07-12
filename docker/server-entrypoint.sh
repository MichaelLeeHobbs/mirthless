#!/bin/sh
# ===========================================
# Server Container Entrypoint
# ===========================================
# Runs DB migrations, then the idempotent seed, then execs the server.
# Fail-loud: any migration error aborts startup (set -e). The seed is
# idempotent and can be skipped with SEED_ON_START=false.

set -e

echo "[entrypoint] running database migrations..."
node packages/server/migrate.mjs

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] running database seed (idempotent)..."
  node packages/server/dist/db/seeds/run-seed.js
else
  echo "[entrypoint] skipping seed (SEED_ON_START=${SEED_ON_START})"
fi

echo "[entrypoint] starting server..."
exec "$@"
