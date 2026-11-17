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

/**
 * A second, deliberately awkward server for e2e/closed.spec.ts: it is closed right now
 * and accepts only one visitor. The web app is told its server address when it is built,
 * so that server gets its own copy of the web app too.
 */
const SPECIAL_SERVER_PORT = 3102;
const SPECIAL_WEB_PORT = 5274;
const SPECIAL_WEB_URL = `http://localhost:${SPECIAL_WEB_PORT}`;
/** A half-hour opening window that starts about six hours from now, in Indian time. */
function windowOpeningLater(): string {
  const indianHour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  const opens = String((indianHour + 6) % 24).padStart(2, '0');
  return `${opens}:00-${opens}:30`;
}

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
        // How long a call is kept for someone whose connection dropped. 10 s in
        // production; short here so tests of "did not come back" are quick.
        RECONNECT_GRACE_MS: '1500',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      env: { VITE_SERVER_URL: `http://localhost:${SERVER_PORT}` },
    },
    {
      command: 'npx tsx --conditions=source src/index.ts',
      cwd: '../server',
      url: `http://localhost:${SPECIAL_SERVER_PORT}/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(SPECIAL_SERVER_PORT),
        CORS_ORIGIN: SPECIAL_WEB_URL,
        OPEN_WINDOWS: windowOpeningLater(),
        MAX_CLIENTS: '1',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npx vite --port ${SPECIAL_WEB_PORT} --strictPort`,
      url: SPECIAL_WEB_URL,
      reuseExistingServer: false,
      env: { VITE_SERVER_URL: `http://localhost:${SPECIAL_SERVER_PORT}` },
    },
  ],
});
