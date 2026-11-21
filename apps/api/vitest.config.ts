import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // test/ talks to a real server + Postgres started by globalSetup (only when TEST_DATABASE_URL is set).
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
  },
});
