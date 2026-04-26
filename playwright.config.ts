import { defineConfig } from '@playwright/test';
import { TEST_WS_PORT } from './tests/helpers/constants';


export default defineConfig({
  testDir: './tests',
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
  timeout: 30_000,
  workers: 1,
  use: {
    browserName: 'chromium',
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `npx vite --port 5199 --strictPort`,
    port: 5199,
    reuseExistingServer: false,
    env: {
      VITE_WS_URL: `ws://localhost:${TEST_WS_PORT}`,
    },
  },
});
