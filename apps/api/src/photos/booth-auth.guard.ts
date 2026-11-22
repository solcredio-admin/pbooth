import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma.service.js";
import { hashToken } from "../auth/tokens.js";
import { ApiError } from "../common/errors.js";
import { KIOSK_COOKIE } from "../kiosk/kiosk.guard.js";

export type BoothReq = FastifyRequest & { booth?: { boothId: string; via: "kiosk" | "agent" } };

// Photo uploads come from the booth: its kiosk (HttpOnly cookie) or its agent (device token).
@Injectable()
export class BoothAuthGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<BoothReq>();
    const cookie = req.cookies?.[KIOSK_COOKIE];
    if (cookie) {
      const k = await this.db.kiosk.findUnique({ where: { tokenHash: hashToken(cookie) }, select: { boothId: true, booth: { select: { state: true } } } });
      if (k && k.booth.state !== "REVOKED") { req.booth = { boothId: k.boothId, via: "kiosk" }; return true; }
    }
    const bearer = /^Bearer (pbd_[A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "")?.[1];
    if (bearer) {
      const d = await this.db.device.findUnique({ where: { tokenHash: hashToken(bearer) }, select: { boothId: true, booth: { select: { state: true } } } });
      if (d && d.booth.state !== "REVOKED") { req.booth = { boothId: d.boothId, via: "agent" }; return true; }
    }
    throw new ApiError(HttpStatus.UNAUTHORIZED, "BOOTH_UNAUTHORIZED", "Only a paired kiosk or enrolled agent may upload photos");
  }
}
