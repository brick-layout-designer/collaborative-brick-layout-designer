import { defineConfig, devices } from '@playwright/test';

// E2E tests require the full stack:
//   - Vite dev server proxying to Fastify at :3000
//   - Fastify server with ENABLE_PASSWORD_AUTH=true
//
// Run with:
//   pnpm --filter @cld/web exec playwright test
//
// Before running set environment variables used by the server in your shell:
//   export DB_PATH=/tmp/cld-e2e-test.sqlite
//   export ENABLE_PASSWORD_AUTH=true
//   export COOKIE_SECURE=false
//   export PUBLIC_URL=http://localhost:5173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Persist auth state inside a browser context so tests can share login.
    storageState: undefined,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Bring up Vite dev server (which proxies to the already-running Fastify).
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
