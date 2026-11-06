import { defineConfig } from '@playwright/test';
const port = Number(process.env.RWN_QA_PORT || 4197);
const baseURL = process.env.RWN_BASE_URL || `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './browser-tests', testMatch: '*.spec.js', fullyParallel: false,
  workers: 1, retries: 0, timeout: 60000, expect: { timeout: 15000 },
  reporter: [['list'], ['json', { outputFile: process.env.RWN_QA_REPORT || 'qa-cross-browser/results.json' }]],
  outputDir: 'qa-cross-browser/artifacts',
  use: { baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: process.env.RWN_BASE_URL ? undefined : {
    command: `node scripts/serve.mjs ${port}`, url: baseURL + '/directory',
    reuseExistingServer: !process.env.CI, timeout: 30000
  }
});
