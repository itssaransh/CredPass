import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test',
  fullyParallel: false,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
