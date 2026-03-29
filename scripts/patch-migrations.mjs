#!/usr/bin/env node
// Makes all migration SQL files idempotent.
// Run once: node scripts/patch-migrations.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'packages/server/src/db/migrations';
const files = readdirSync(dir).filter(f => f.endsWith('.sql'));

for (const file of files) {
  const filePath = join(dir, file);
  let sql = readFileSync(filePath, 'utf8');
  const original = sql;

  // CREATE TABLE -> CREATE TABLE IF NOT EXISTS
  sql = sql.replace(/CREATE TABLE "(?!IF)/g, 'CREATE TABLE IF NOT EXISTS "');

  // CREATE INDEX -> CREATE INDEX IF NOT EXISTS
  sql = sql.replace(/CREATE INDEX "(?!IF)/g, 'CREATE INDEX IF NOT EXISTS "');

  // CREATE UNIQUE INDEX -> CREATE UNIQUE INDEX IF NOT EXISTS
  sql = sql.replace(/CREATE UNIQUE INDEX "(?!IF)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "');

  // ALTER TABLE ... ADD COLUMN -> ADD COLUMN IF NOT EXISTS
  sql = sql.replace(/ADD COLUMN "(?!IF)/g, 'ADD COLUMN IF NOT EXISTS "');

  // ALTER TABLE ... ADD CONSTRAINT ... -> DROP IF EXISTS then ADD
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
