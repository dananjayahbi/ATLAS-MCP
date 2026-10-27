import { defineConfig, devices } from "@playwright/test";

const WEB = process.env.ATLAS_WEB_URL ?? "http://127.0.0.1:3471";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The dev servers are started by `scripts/bootstrap_dev.py` in CI; locally
  // run `npm run dev` + the Django server first.
  webServer: process.env.ATLAS_E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: WEB,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
