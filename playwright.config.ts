import { defineConfig, devices } from '@playwright/test';

const frontendUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3420';
const frontendOrigin = new URL(frontendUrl).origin;

const onboardedStorageState = {
  cookies: [],
  origins: [
    {
      origin: frontendOrigin,
      localStorage: [
        {
          name: 'neumar_settings',
          value: JSON.stringify({ language: 'en-US' }),
        },
        { name: 'neumar_onboardingCompleted', value: 'true' },
        { name: 'neumar_onboardingVersion', value: '1' },
        { name: 'neumar_quickstart_step', value: 'completed' },
      ],
    },
  ],
};

const webServer =
  process.env.PLAYWRIGHT_NO_WEBSERVER === '1'
    ? []
    : [
        {
          // --env-file-if-exists so the server still boots when src-api/.env is
          // absent (it is gitignored, so CI has no file) — `--env-file` exits 9
          // on a missing file and killed the browser-e2e job before any test.
          command: 'node --import tsx --env-file-if-exists=.env src/index.ts',
          cwd: './src-api',
          url: 'http://127.0.0.1:5126/health',
          reuseExistingServer: true,
          env: { ...process.env, CI: 'true' },
          timeout: 30_000,
        },
        {
          command: 'node_modules/.bin/vite --host localhost',
          url: frontendUrl,
          reuseExistingServer: true,
          env: { ...process.env, CI: 'true' },
          timeout: 30_000,
        },
      ];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 60_000,

  use: {
    baseURL: frontendUrl,
    storageState: onboardedStorageState,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer,
});
