import "reflect-metadata";
import { Logger, StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { IoAdapter } from "@nestjs/platform-socket.io";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { ApiError } from "./common/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function bootstrap() {
  const cfg = loadConfig();
  const log = new Logger("Boot");
  if (!cfg.cookieSecure && cfg.NODE_ENV === "production") {
    log.warn(`APP_ORIGIN is ${cfg.APP_ORIGIN} (not https): session cookies are NOT marked Secure.`);
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(cfg),
    new FastifyAdapter({
      trustProxy: (_addr: string, hop: number) => hop < cfg.TRUST_PROXY_HOPS,
      bodyLimit: 300 * 1024, // an event's logo (a small PNG) is the biggest thing sent
      // Fastify's request log has method, URL, status and IP; no headers, so no cookies or tokens.
      logger: { level: cfg.NODE_ENV === "test" ? "warn" : "info" },
    }),
  );

  await app.register(helmet, { contentSecurityPolicy: false }); // JSON API; the web app sets the page CSP
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // CSRF: a browser always sends Origin on POST/PATCH/DELETE. If it isn't our own site, refuse.
  // (Non-browser clients can't carry the admin's cookie, so they're not a CSRF risk.)
  app.getHttpAdapter().getInstance().addHook("onRequest", async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (origin ? origin !== cfg.APP_ORIGIN : site !== undefined && site !== "same-origin") {
      reply.code(403).send({ error: { code: "BAD_ORIGIN", message: "Request blocked: unexpected origin" } });
    }
  });

  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new StandardSchemaValidationPipe({
    exceptionFactory: (issues) => new ApiError(400, "VALIDATION_ERROR", "Some fields are invalid",
      issues.map((i) => ({ path: (i.path ?? []).map((p) => (typeof p === "object" ? p.key : p)).join("."), message: i.message }))),
  }));
  app.useWebSocketAdapter(new IoAdapter(app)); // Socket.IO on the same port, path /socket.io
  app.enableShutdownHooks();

  await app.listen(cfg.API_PORT, cfg.API_HOST);
  log.log(`API listening on http://${cfg.API_HOST}:${cfg.API_PORT}/api/v1`);
}

bootstrap().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
