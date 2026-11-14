import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'web',
    environment: 'node',
    // Only unit tests next to the source. Browser tests in e2e/ are run by Playwright.
    include: ['src/**/*.test.ts'],
  },
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
});
