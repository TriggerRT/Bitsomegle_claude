import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end ("e2e") tests: Playwright opens real browser windows and uses the app the
 * way a person would, against a real server.
 *
 * The tests start their own server and web app on ports that differ from the ones used
 * by `npm run dev`, so they never interfere with what you have running.
 */
const SERVER_PORT = 3101;
const WEB_PORT = 5273;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The tests share one server and one matchmaking queue, so they must not overlap.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        // Chromium's built-in pretend camera (a moving test pattern) and microphone (beeps),
        // so tests make real video calls without any hardware.
        '--use-fake-device-for-media-stream',
        // Answer the "allow camera?" prompt automatically.
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx --conditions=source src/index.ts',
      cwd: '../server',
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(SERVER_PORT),
        CORS_ORIGIN: WEB_URL,
        OPEN_WINDOWS: '',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      env: { VITE_SERVER_URL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
