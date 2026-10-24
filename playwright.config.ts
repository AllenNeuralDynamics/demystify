import { defineConfig, devices } from '@playwright/test'

const webUrl = 'http://127.0.0.1:4173'
const useProductionBuild = process.env.DEMYSTIFY_E2E_BUILD === '1'

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : useProductionBuild ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [{
    command: 'npm run test:e2e:server',
    url: 'http://127.0.0.1:8791/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  }, {
    command: useProductionBuild
      ? 'NODE_ENV=production npm run build && NODE_ENV=production DEMYSTIFY_API_TARGET=http://127.0.0.1:8791 npm run preview -- --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run build && npm run test:e2e:web',
    url: webUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  }],
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }, {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  }, {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  }, {
    name: 'mobile-chrome',
    use: { ...devices['Pixel 7'] },
  }, {
    name: 'mobile-safari',
    use: { ...devices['iPhone 13'] },
  }],
})
