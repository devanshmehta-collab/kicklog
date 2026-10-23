import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile.spec.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AI_MODE: "mock", // deterministic stand-in for Claude; all validation + money maths are the real code
      PGLITE_DIR: ".data/e2e-pglite",
      OWNER_EMAIL: "e2e-owner@kicklog.test",
      OWNER_PASSWORD: "E2e-Owner-Passw0rd",
      NEXT_PUBLIC_WHATSAPP_NUMBER: "919876543210",
    },
  },
});
