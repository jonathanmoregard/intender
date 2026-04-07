#!/usr/bin/env node

/**
 * Bumps version.txt by one patch level.
 *
 * Usage: pnpm bump
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const versionFile = join(__dirname, '../version.txt');

const current = readFileSync(versionFile, 'utf8').trim();
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`Invalid version in version.txt: ${current}`);
  process.exit(1);
}
parts[2] += 1;
const next = parts.join('.');
writeFileSync(versionFile, `${next}\n`);
console.log(`${current} -> ${next}`);
