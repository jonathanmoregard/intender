import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/components/**/*.ts', 'src/entrypoints/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', 'tests/**'],
    },
  },
});
