import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running pbooth (E2E_BASE_URL). Chromium's fake camera stands in for a
// webcam. These prove the flows, not specific camera hardware.
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3399",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    permissions: ["camera"],
  },
});
