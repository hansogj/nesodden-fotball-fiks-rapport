import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

// Load .env.test if present (never committed — add credentials here)
config({ path: '.env.test' });

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,        // FIKS login tests must run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Step 1: authenticate to FIKS and save storage state
    {
      name: 'fiks-setup',
      testMatch: '**/fiks-auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // Step 2: UI tests for our Next.js app
    {
      name: 'app-ui',
      testMatch: '**/app.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3210',
      },
    },

    // Step 3: Data accuracy tests — compare our app with FIKS
    {
      name: 'data-accuracy',
      testMatch: '**/accuracy.spec.ts',
      dependencies: ['fiks-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/fiks.json',
      },
    },

    // On-demand sync: scrape real data from fiks.fotball.no → data/synced-data.json
    {
      name: 'sync',
      testMatch: '**/fiks-sync.spec.ts',
      dependencies: ['fiks-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/fiks.json',
      },
    },

    // Fast sync: reuses existing .auth/fiks.json (no re-auth) when session is still valid
    {
      name: 'sync-fresh',
      testMatch: '**/fiks-sync.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/fiks.json',
      },
    },

    // Kamptropp verification: confirms squad data comes from FIKS, not mock
    {
      name: 'kamptropp',
      testMatch: '**/kamptropp.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // Cross-team player detection: all API calls mocked, no FIKS credentials needed
    {
      name: 'cross-team',
      testMatch: '**/cross-team.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3210',
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3210',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
