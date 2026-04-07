#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCurrentVersion() {
  return readFileSync(join(__dirname, '../version.txt'), 'utf8').trim();
}

function getLatestMasterVersion() {
  try {
    // Fetch latest from remote
    execSync('git fetch origin master', { stdio: 'ignore' });

    // Get the version from master's version.txt
    return execSync('git show origin/master:version.txt', {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    console.log(
      'Could not fetch latest master version, assuming first version'
    );
    return '0.0.0';
  }
}

function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (currentParts[i] > latestParts[i]) return 'higher';
    if (currentParts[i] < latestParts[i]) return 'lower';
  }
  return 'same';
}

function main() {
  const currentVersion = getCurrentVersion();
  const latestVersion = getLatestMasterVersion();
  const comparison = compareVersions(currentVersion, latestVersion);

  console.log(`Current version: ${currentVersion}`);
  console.log(`Latest master version: ${latestVersion}`);

  if (comparison === 'lower') {
    console.log('\n❌ ERROR: Your version is lower than master!');
    console.log('Please bump your version before creating a PR.');
    process.exit(1);
  } else if (comparison === 'same') {
    console.log('\n❌ ERROR: Your version is the same as master!');
    console.log('Please bump your version before creating a PR.');
    process.exit(1);
  } else {
    console.log('\n✅ Version is higher than master. Good to go!');
    process.exit(0);
  }
}

main();
