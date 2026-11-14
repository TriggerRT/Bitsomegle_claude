import { defineConfig } from 'vitest/config';

// One `npm test` runs every package's tests. Each package has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/server', 'apps/web'],
  },
});
