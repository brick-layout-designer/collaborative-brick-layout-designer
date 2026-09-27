import { defineConfig, devices } from '@playwright/test';

// E2E tests require the full stack, already running:
//   - Fastify server (apps/server) on :3000 with ENABLE_PASSWORD_AUTH=true
//   - Vite dev server (apps/web) on :5173, proxying /api, /ws, /parts to it
//     (started for you via `webServer` below if it isn't already up)
//
// 1. Start the server from apps/server (once per fresh DB, run the migration first):
//      export DB_PATH=/tmp/cld-e2e.sqlite ENABLE_PASSWORD_AUTH=true \
//             COOKIE_SECURE=false PUBLIC_URL=http://localhost:5173 \
//             PARTS_DIR=<path to a BlueBrick parts library> BACKUPS_DIR=/tmp/cld-e2e-backups
//      npx tsx src/db/migrate.ts && npx tsx src/index.ts
//
// 2. Run the suite from apps/web with the SAME DB_PATH exported — the
//    tests read email-verification tokens straight from that SQLite file
//    (see e2e/dbHelpers.ts):
//      DB_PATH=/tmp/cld-e2e.sqlite pnpm --filter @cld/web exec playwright test
//
// Optional env:
//   PW_CHROMIUM_EXECUTABLE  use this Chromium binary instead of Playwright's
//                           bundled one (e.g. when `playwright install` isn't
//                           possible or the bundled revision doesn't match).
//   E2E_BASE_URL            where the web app is served (default http://localhost:5173).
//
// Register/login are rate-limited (10/min per IP); e2e/helpers.ts keeps
// the suite inside that budget and waits out any 429, so back-to-back
// runs are fine — just slower when they overlap the previous run's window.

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Persist auth state inside a browser context so tests can share login.
    storageState: undefined,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],

  // Bring up Vite dev server (which proxies to the already-running Fastify).
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
