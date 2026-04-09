#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCurrentVersion() {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '../package.json'), 'utf8')
  );
  return pkg.version;
}

function getLatestMasterVersion() {
  try {
    execSync('git fetch origin master', { stdio: 'ignore' });
    const pkg = JSON.parse(
      execSync('git show origin/master:package.json', { encoding: 'utf8' })
    );
    return pkg.version;
  } catch (error) {
    console.log(
      'Could not fetch latest master version, assuming first version'
    );
    return '0.0.0';
  }
}

function hasSrcChangesVsMaster() {
  try {
    const result = execSync('git diff origin/master...HEAD --name-only', {
      encoding: 'utf8',
    });
    return result.split('\n').some(f => f.startsWith('src/'));
  } catch {
    return true; // assume changes if we can't check
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
  const srcChanged = hasSrcChangesVsMaster();

  console.log(`Current version: ${currentVersion}`);
  console.log(`Latest master version: ${latestVersion}`);
  console.log(`src/ changes vs master: ${srcChanged}`);

  if (comparison === 'lower') {
    console.log('\n❌ ERROR: Your version is lower than master!');
    console.log('Please bump your version before creating a PR.');
    process.exit(1);
  }

  if (comparison === 'same' && srcChanged) {
    console.log(
      '\n❌ ERROR: src/ has changes but version is the same as master!'
    );
    console.log('Please bump your version before creating a PR.');
    process.exit(1);
  }

  console.log('\n✅ Version check passed. Good to go!');
  process.exit(0);
}

main();
