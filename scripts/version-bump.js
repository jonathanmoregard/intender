#!/usr/bin/env node

/**
 * Bumps the version in package.json by one patch level.
 *
 * Usage: pnpm bump
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgFile = join(__dirname, '../package.json');

const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
const current = pkg.version;
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`Invalid version in package.json: ${current}`);
  process.exit(1);
}
parts[2] += 1;
const next = parts.join('.');
pkg.version = next;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`${current} -> ${next}`);
