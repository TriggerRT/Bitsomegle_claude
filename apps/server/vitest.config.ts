import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
  },
  // Load '@bitsomeggle/shared' from its TypeScript source in tests.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
});
