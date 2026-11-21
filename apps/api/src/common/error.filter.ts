import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Prisma } from "../generated/prisma/client.js";

const CODES: Record<number, string> = {
  400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
  409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 429: "RATE_LIMITED",
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(err: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const [status, body] = this.toBody(err);
    reply.status(status).send(body);
  }

  private toBody(err: unknown): [number, unknown] {
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const res = err.getResponse();
      if (typeof res === "object" && res && "error" in res && typeof res.error === "object") return [status, res];
      const message = typeof res === "string" ? res : ((res as { message?: unknown }).message ?? err.message);
      const details = Array.isArray(message) ? message : undefined;
      return [status, { error: {
        code: status === 400 && details ? "VALIDATION_ERROR" : (CODES[status] ?? "ERROR"),
        message: details ? "Some fields are invalid" : String(message),
        ...(details ? { details } : {}),
      } }];
    }
    // Fastify's own errors (rate limit, bad JSON, body too large) carry a statusCode.
    const fe = err as { statusCode?: number; message?: string };
    if (typeof fe?.statusCode === "number" && fe.statusCode < 500) {
      return [fe.statusCode, { error: { code: CODES[fe.statusCode] ?? "ERROR", message: fe.message ?? "Request failed" } }];
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return [404, { error: { code: "NOT_FOUND", message: "Record not found" } }];
    }
    // Unknown failure: log the stack for the admin, return nothing internal to the client.
    this.log.error(err instanceof Error ? err.stack : String(err));
    return [HttpStatus.INTERNAL_SERVER_ERROR, { error: { code: "INTERNAL", message: "Something went wrong" } }];
  }
}
