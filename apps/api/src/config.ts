import { z } from "zod";

// Every setting the API needs, checked once at boot. A missing or malformed value
// stops the process with a clear message instead of failing later mid-event.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  // The public address people type in the browser, e.g. https://pbooth.solcredio.net.
  // Used for the CSRF origin check and to decide whether cookies are Secure.
  APP_ORIGIN: z.string().url().transform((u) => new URL(u).origin),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // How many proxies sit in front of the API (Caddy → Next = 2). Used to read the real client IP.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(2),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // A booth with no heartbeat for this long shows as offline.
  BOOTH_OFFLINE_AFTER_SECONDS: z.coerce.number().int().min(30).default(90),
  // How often booths are told to check in.
  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(20),
  // Simulated booths (tools/simulate-booth.mjs) are for development and staging; off unless enabled.
  ALLOW_SIMULATED_BOOTHS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema> & { cookieSecure: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const cfg = parsed.data;
  return { ...cfg, cookieSecure: cfg.APP_ORIGIN.startsWith("https://") };
}

export const CONFIG = Symbol("CONFIG");
