import { defineConfig } from 'vitest/config';

// One `npm test` runs every package's tests. Each package has its own vitest.config.ts.
// The web app joins this list in Milestone M3 when it gets its first tests.
export default defineConfig({
  test: {
    projects: ['packages/shared', 'apps/server'],
  },
});
