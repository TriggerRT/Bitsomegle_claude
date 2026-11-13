import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Load '@bitsomeggle/shared' from its TypeScript source (no separate build step needed).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { port: 5173 },
});
