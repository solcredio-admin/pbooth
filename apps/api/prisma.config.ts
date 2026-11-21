import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` (at build time) needs no database, so a missing URL is allowed here;
  // the API (src/config.ts) and the container entrypoint refuse to start without one.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
