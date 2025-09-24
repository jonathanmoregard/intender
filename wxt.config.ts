import { readFileSync } from 'fs';
import { defineConfig } from 'wxt';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  vite: ({ mode }) => ({
    define: {
      __IS_DEV__: mode === 'development',
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
