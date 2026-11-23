import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running pbooth (E2E_BASE_URL).
//  - kiosk: the booth flow in Chromium, whose fake camera stands in for a webcam (offline.spec.ts)
//  - the rest: the pages people open on their own devices, in every engine (browsers.spec.ts)
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3399";
const browsers = /browsers\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL },
  projects: [
    {
      name: "kiosk",
      testMatch: /(offline|peek|voucher|screen)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
        permissions: ["camera"],
      },
    },
    {
      // the same booth flow in Firefox, with its built-in fake camera
      name: "kiosk-firefox",
      testMatch: /(offline|peek|voucher|screen)\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 800 },
        launchOptions: { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } },
      },
    },
    { name: "iphone-safari", testMatch: browsers, use: { ...devices["iPhone 15"] } },
    { name: "android-chrome", testMatch: browsers, use: { ...devices["Pixel 7"] } },
    { name: "desktop-safari", testMatch: browsers, use: { ...devices["Desktop Safari"] } },
    { name: "desktop-firefox", testMatch: browsers, use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-chrome", testMatch: browsers, use: { ...devices["Desktop Chrome"] } },
  ],
});
