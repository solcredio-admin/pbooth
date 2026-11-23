import { z } from "zod";

// "VAR=" in .env (or docker compose's ${VAR:-}) arrives as an empty string: treat it as unset.
const blank = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t.optional());

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
  // Photo storage: any S3-compatible bucket (Cloudflare R2 in production, MinIO in tests).
  // All five must be set to turn storage on; otherwise photos simply aren't saved.
  S3_ENDPOINT: blank(z.string().url()),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: blank(z.string().min(3)),
  S3_ACCESS_KEY_ID: blank(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: blank(z.string().min(1)),
  MAX_PHOTO_MB: z.coerce.number().int().min(1).max(100).default(30),
  // QR payments for self-service booths (PayMongo, QR Ph). Unset = QR payment off, vouchers still work.
  PAYMONGO_SECRET_KEY: blank(z.string().regex(/^sk_(test|live)_/, "Use your PayMongo secret key (sk_test_… or sk_live_…)")),
  PAYMONGO_API_BASE: z.string().url().default("https://api.paymongo.com/v1"), // overridden only by tests
  // How long a payment QR stays valid at the booth (PayMongo allows 60–9000 s).
  PAYMONGO_QR_SECONDS: z.coerce.number().int().min(60).max(9000).default(600),
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
