import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'wxt';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
let gitHash = 'dev';
try {
  gitHash = execSync('git rev-parse --short HEAD', {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  // leave default
}

export default defineConfig({
  vite: ({ mode }) => ({
    define: {
      __IS_DEV__: mode === 'development',
      __VERSION__: JSON.stringify(packageJson.version),
      __GIT_HASH__: JSON.stringify(gitHash),
    },
    resolve: {
      alias: {
        '@theme': resolve(__dirname, 'entrypoints/shared/theme.css'),
      },
    },
  }),
  manifest: {
    name: 'Intender',
    description: packageJson.description,
    version: packageJson.version,
    manifest_version: 3,
    permissions: ['storage', 'webNavigation', 'tabs', 'idle'],
    optional_host_permissions: [],
    background: {
      service_worker: 'entrypoints/background.ts',
      type: 'module',
    },

    action: {
      default_popup: 'entrypoints/popup/index.html',
    },
    icons: {
      16: 'icon/intender-16.png',
      32: 'icon/intender-32.png',
      48: 'icon/intender-48.png',
      128: 'icon/intender-128.png',
    },
  },
});
