#!/usr/bin/env node
// Run from the repository root: node scripts/patch-migrations.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'packages/server/src/db/migrations';
const files = readdirSync(dir).filter(f => f.endsWith('.sql'));

for (const file of files) {
  const filePath = join(dir, file);
  let sql = readFileSync(filePath, 'utf8');
  const original = sql;

  sql = sql.replace(/CREATE TABLE "(?!IF)/g, 'CREATE TABLE IF NOT EXISTS "');

  sql = sql.replace(/CREATE INDEX "(?!IF)/g, 'CREATE INDEX IF NOT EXISTS "');

  sql = sql.replace(/CREATE UNIQUE INDEX "(?!IF)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "');

  sql = sql.replace(/ADD COLUMN "(?!IF)/g, 'ADD COLUMN IF NOT EXISTS "');

  sql = sql.replace(
    /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/g,
    'ALTER TABLE "$1" DROP CONSTRAINT IF EXISTS "$2";\nALTER TABLE "$1" ADD CONSTRAINT "$2"'
  );

  if (sql !== original) {
    writeFileSync(filePath, sql);
    console.log(`  patched: ${file}`);
  } else {
    console.log(`  skip:    ${file} (already idempotent)`);
  }
}

console.log('\nDone.');
