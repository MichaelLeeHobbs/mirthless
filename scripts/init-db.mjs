#!/usr/bin/env node
// ===========================================
// Initialize Mirthless Database (Cross-Platform)
// ===========================================
// Creates the mirthless database and user on a local PostgreSQL instance.
// Safe to run multiple times — checks for existing user/database.
//
// Usage:
//   node scripts/init-db.mjs                         # defaults
//   pnpm db:init                                     # via npm script
//
// Environment variables (all optional):
//   PGHOST       PostgreSQL host          (default: localhost)
//   PGPORT       PostgreSQL port          (default: 5432)
//   PGUSER       Superuser for setup      (default: postgres)
//   PGPASSWORD   Superuser password       (default: postgres)
//   DB_NAME      Database to create       (default: mirthless)
//   DB_USER      App user to create       (default: mirthless)
//   DB_PASSWORD  App user password        (default: mirthless_dev)
//
// Platform scripts also available:
//   Linux/macOS:  ./scripts/init-db.sh
//   Windows:      .\scripts\init-db.ps1

import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const pg = require('pg');

const PGHOST     = process.env.PGHOST     || 'localhost';
const PGPORT     = process.env.PGPORT     || '5432';
const PGUSER     = process.env.PGUSER     || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';
const DB_NAME    = process.env.DB_NAME    || 'mirthless';
const DB_USER    = process.env.DB_USER    || 'mirthless';
const DB_PASSWORD= process.env.DB_PASSWORD|| 'mirthless_dev';

async function main() {
  console.log('=== Mirthless Database Setup ===');
  console.log(`  Host:     ${PGHOST}:${PGPORT}`);
  console.log(`  Admin:    ${PGUSER}`);
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  App user: ${DB_USER}`);
  console.log('');

  // Connect as superuser to the default 'postgres' database
  const adminPool = new pg.Pool({
    host: PGHOST,
    port: Number(PGPORT),
    user: PGUSER,
    password: PGPASSWORD,
    database: 'postgres',
    max: 1,
  });

  try {
    // Check connection
    const versionResult = await adminPool.query('SELECT version()');
    const version = versionResult.rows[0].version.split(',')[0];
    console.log(`  Connected: ${version}`);
    console.log('');

    // 1. Create user
    process.stdout.write(`1. Creating user '${DB_USER}'...`);
    const userExists = await adminPool.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1", [DB_USER]
    );
    if (userExists.rows.length > 0) {
      console.log(' already exists.');
    } else {
      // Can't use $1 for role names in CREATE USER — but this is a setup script with controlled input
      await adminPool.query(`CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}'`);
      console.log(' created.');
    }

    // 2. Create database
    process.stdout.write(`2. Creating database '${DB_NAME}'...`);
    const dbExists = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]
    );
    if (dbExists.rows.length > 0) {
      console.log(' already exists.');
    } else {
      await adminPool.query(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}`);
      console.log(' created.');
    }

    // 3. Grant privileges
    process.stdout.write('3. Granting privileges...');
    await adminPool.query(`GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER}`);
    console.log(' done.');

    console.log('');
    console.log('=== Setup Complete ===');
    console.log('');
    console.log('Connection string:');
    console.log(`  DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Update DATABASE_URL in .env if needed');
    console.log('  2. pnpm db:migrate    # apply schema migrations');
    console.log('  3. pnpm db:seed       # seed admin user + defaults');
    console.log('  4. pnpm dev           # start the server');
  } catch (err) {
    console.log('');
    console.error('');
    console.error(`ERROR: ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
      console.error('');
      console.error('Cannot connect to PostgreSQL. Check:');
      console.error(`  - Is PostgreSQL running on ${PGHOST}:${PGPORT}?`);
      console.error('  - Windows: check Services (services.msc) for postgresql-*');
      console.error('  - Linux: sudo systemctl status postgresql');
    } else if (err.code === '28P01') {
      console.error('');
      console.error('Authentication failed. Set the superuser password:');
      console.error(`  PGPASSWORD=<password> pnpm db:init`);
    }
    process.exit(1);
  } finally {
    await adminPool.end();
  }
}

main();
