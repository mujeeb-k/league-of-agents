import { defineConfig, devices } from '@playwright/test';
import { APP } from './tests/support/targets';

// The built app (web/dist) is served as static files; the dev server is never used.
const base = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  contextOptions: { reducedMotion: 'reduce' as const },
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/pw',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{platform}{ext}',
  webServer: [{ command: 'node tests/support/static-server.mjs 4173 dist', url: APP, reuseExistingServer: true }],
  projects: [
    { name: 'app', testMatch: /interactions\.spec\.ts/, use: { ...base, baseURL: APP } },
    { name: 'live', testMatch: /live\.spec\.ts/, use: base },
    { name: 'visual', testMatch: /visual\.spec\.ts/, use: { ...base, baseURL: APP } },
    { name: 'states', testMatch: /states\.spec\.ts/, use: base },
    { name: 'screens', testMatch: /screens\.spec\.ts/, use: base },
    // The README's GIF and the social preview image. Run alone with `npm run media`.
    { name: 'media', testMatch: /(gif|og)\.spec\.ts/, use: base },
    // A large public repository and the real Claude Code. Run alone with `npm run large`.
    { name: 'large', testMatch: /large\.spec\.ts/, use: base },
    // Real motion, so no reduced-motion preference. Run alone with `npm run perf`. In the installed Chrome, as
    // people use it: Playwright's own Chromium paints differently (pan on react-router before 016: 10% of frames
    // dropped there, 40% in Chrome).
    {
      name: 'perf',
      testMatch: /perf\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } },
    },
  ],
});
