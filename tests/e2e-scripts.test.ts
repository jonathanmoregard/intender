import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts: Record<string, string> };
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe.each([
  'test:e2e',
  'test:e2e:ci',
  'test:e2e:robustness-check',
  'test:e2e:throttled',
])('%s exit status', script => {
  it.each(['e2e-parallel', 'e2e-serial', 'none'])(
    'reports a failure in %s',
    failingProject => {
      const directory = mkdtempSync(join(tmpdir(), 'intender-script-test-'));
      directories.push(directory);
      writeFileSync(join(directory, 'npm'), '#!/bin/sh\nexit 0\n', {
        mode: 0o700,
      });
      writeFileSync(
        join(directory, 'playwright'),
        '#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "--project=$FAILING_PROJECT" ]; then exit 17; fi\ndone\nexit 0\n',
        { mode: 0o700 }
      );
      const result = spawnSync('/bin/sh', ['-c', scripts[script]], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAILING_PROJECT: failingProject,
        },
        encoding: 'utf8',
        stdio: 'inherit',
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(failingProject === 'none' ? 0 : 17);
    }
  );
});
