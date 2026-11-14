import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  // On Vercel, stop the build if the server address is missing or wrong. Otherwise the
  // site would deploy "successfully" and then show a blank page to every visitor.
  if (command === 'build' && process.env.VERCEL) checkServerUrl(process.env.VITE_SERVER_URL);

  return {
    plugins: [react()],
    // Load '@bitsomeggle/shared' from its TypeScript source (no separate build step needed).
    resolve: { conditions: ['source', ...defaultClientConditions] },
    server: { port: 5173 },
  };
});

function checkServerUrl(value: string | undefined): void {
  const example = 'for example https://bitsomeggle.onrender.com';
  if (!value) {
    throw new Error(
      `VITE_SERVER_URL is not set. Add it in the Vercel project settings (${example}).`,
    );
  }
  if (!URL.canParse(value) || new URL(value).protocol !== 'https:') {
    throw new Error(`VITE_SERVER_URL "${value}" must be a full https:// address (${example}).`);
  }
}
