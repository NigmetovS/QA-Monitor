import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], 
  ['./reporters/telegram-reporter.ts'], 
  ['./reporters/supabase-reporter.ts'], 
  ['json', { outputFile: 'results.json' }]],
  use: {
    baseURL: process.env.TARGET_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'], 
  },
  webServer: process.env.TARGET_URL ? undefined : {
    command: 'node demo/server.cjs',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
