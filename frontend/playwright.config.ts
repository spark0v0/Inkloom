import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 35000,
  expect: { timeout: 8000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:9876', channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:9876/api/v1/health', reuseExistingServer: false, timeout: 30000 },
})
