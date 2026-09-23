import { defineConfig, devices } from "@playwright/test";

const localDemo = process.env.PLAYWRIGHT_LOCAL_DEMO === "1";
const localBaseUrl = localDemo ? "http://127.0.0.1:4175" : "http://127.0.0.1:4174";
const webServerCommand = localDemo
  ? "npm run dev:demo -- --host 127.0.0.1 --port 4175 --strictPort"
  : "PLAYWRIGHT_E2E=1 npm run dev -- --host 127.0.0.1 --port 4174 --strictPort";

export default defineConfig({
  testDir: "./e2e",
  // The normal suite retains its no-D1-state failure semantics. The demo spec is opt-in and runs
  // only when the Node launcher sets PLAYWRIGHT_LOCAL_DEMO for its separate Vite server.
  testIgnore: localDemo ? undefined : "local-published-demo.spec.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: localBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: localBaseUrl,
    // The standard suite gets an ephemeral Worker; the explicit demo suite starts a separate
    // Vite `demo` server. Neither suite reuses a developer's normal dev server.
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      // Local development reuses the user's installed Chrome. CI installs the pinned Playwright
      // Chromium revision, so no developer-machine browser cache becomes a CI dependency.
      use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" },
    },
  ],
});
