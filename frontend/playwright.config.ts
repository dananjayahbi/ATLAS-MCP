import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const WEB = process.env.ATLAS_WEB_URL ?? "http://127.0.0.1:3471";
const API = process.env.ATLAS_API_URL ?? "http://127.0.0.1:8471";

const FRONTEND = __dirname;
const BACKEND = path.resolve(FRONTEND, "..", "backend");

// Absolute, native-separator paths: cmd.exe treats `/` in a command position as
// a switch, so `../.venv/Scripts/python.exe` is unparseable on Windows.
const PY =
  process.env.ATLAS_PYTHON ??
  path.resolve(FRONTEND, "..", ".venv", "Scripts", "python.exe");
const PYTHON = PY.replace(/\\/g, "\\\\");

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
  // The HUD proxies every request to Django, so a backend is mandatory. Both
  // servers are started here unless ATLAS_E2E_NO_SERVER says they already run
  // (that is what `start-atlas.bat` + `npm run test:e2e` does).
  webServer: process.env.ATLAS_E2E_NO_SERVER
    ? undefined
    : [
        {
          command: `"${PYTHON}" -m uvicorn atlas.asgi:application --host 127.0.0.1 --port 8471 --no-access-log`,
          cwd: BACKEND,
          url: `${API}/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: "npm run dev",
          url: WEB,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
