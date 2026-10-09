import { defineConfig, devices } from "@playwright/test";

const hubPort = 8765;
const appPort = 4173;

// Every engine a person is likely to bring, the phone sizes the layout changes at, and reduced
// motion. The app is the production build served by vite preview, proxied to the fake hub, so
// nothing here reaches a real hub or a model (AGENTS.md, invariant 7).
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Locally, PW_CHROMIUM can point at an already-installed Chromium; CI installs its own.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: [
    {
      command: `node scripts/fake-hub.mjs ${hubPort}`,
      url: `http://127.0.0.1:${hubPort}/healthy`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `http://127.0.0.1:${appPort}/`,
      env: { LUCY_URL: `http://127.0.0.1:${hubPort}` },
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "reduced-motion", use: { ...devices["Desktop Chrome"], contextOptions: { reducedMotion: "reduce" } } },
  ],
});
