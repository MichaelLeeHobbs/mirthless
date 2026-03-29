#!/usr/bin/env bash
# ===========================================
# Initialize Mirthless Database (Linux/macOS)
# ===========================================
# Creates the mirthless database and user on a local PostgreSQL instance.
# Safe to run multiple times — uses IF NOT EXISTS / ON CONFLICT.
#
# Prerequisites:
#   - PostgreSQL installed and running locally
#   - psql available on PATH
#   - A superuser account (default: postgres)
#
# Usage:
#   ./scripts/init-db.sh                        # defaults
#   PGUSER=admin PGPORT=5433 ./scripts/init-db.sh  # override connection
#
# Environment variables (all optional):
#   PGHOST       PostgreSQL host          (default: localhost)
#   PGPORT       PostgreSQL port          (default: 5432)
#   PGUSER       Superuser for setup      (default: postgres)
#   PGPASSWORD   Superuser password       (default: postgres)
#   DB_NAME      Database to create       (default: mirthless)
#   DB_USER      App user to create       (default: mirthless)
#   DB_PASSWORD  App user password        (default: mirthless_dev)

set -euo pipefail

# Defaults
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DB_NAME="${DB_NAME:-mirthless}"
DB_USER="${DB_USER:-mirthless}"
DB_PASSWORD="${DB_PASSWORD:-mirthless_dev}"

echo "=== Mirthless Database Setup ==="
echo "  Host:     ${PGHOST}:${PGPORT}"
echo "  Admin:    ${PGUSER}"
echo "  Database: ${DB_NAME}"
echo "  App user: ${DB_USER}"
echo ""

# Check psql is available
if ! command -v psql &> /dev/null; then
  echo "ERROR: psql not found. Install PostgreSQL client tools and ensure psql is on PATH."
  exit 1
fi

# Check connection
if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c "SELECT 1" &> /dev/null; then
  echo "ERROR: Cannot connect to PostgreSQL at ${PGHOST}:${PGPORT} as ${PGUSER}."
  echo "  - Is PostgreSQL running?"
  echo "  - Is the password correct? Set PGPASSWORD=<password>"
  exit 1
fi

echo "1. Creating user '${DB_USER}'..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -tc \
  "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  && echo "   User already exists." \
  || psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c \
    "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" \
  && echo "   User created."

echo "2. Creating database '${DB_NAME}'..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -tc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  && echo "   Database already exists." \
  || psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c \
    "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" \
  && echo "   Database created."

echo "3. Granting privileges..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c \
  "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
echo "   Done."

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Connection string:"
echo "  DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
echo ""
echo "Next steps:"
echo "  1. Update DATABASE_URL in .env if needed"
echo "  2. pnpm db:migrate    # apply schema migrations"
echo "  3. pnpm db:seed       # seed admin user + defaults"
echo "  4. pnpm dev           # start the server"
