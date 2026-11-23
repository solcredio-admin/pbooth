import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma.service.js";
import { hashToken } from "../auth/tokens.js";
import { ApiError } from "../common/errors.js";

export const KIOSK_COOKIE = "pb_kiosk";
export const KIOSK_COOKIE_DAYS = 180; // a booth shouldn't need re-pairing between events; revocable any time
export type KioskReq = FastifyRequest & { kiosk?: { id: string; boothId: string; boothCode: string } };

// The kiosk browser proves itself with an HttpOnly cookie set at pairing. JavaScript on the
// kiosk page can't read it, so there's no secret in the frontend to steal.
@Injectable()
export class KioskGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<KioskReq>();
    const token = req.cookies?.[KIOSK_COOKIE];
    const kiosk = token ? await this.db.kiosk.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, boothId: true, booth: { select: { code: true, state: true } } } }) : null;
    if (!kiosk || kiosk.booth.state === "REVOKED") {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "KIOSK_UNPAIRED", "This browser isn't paired with a booth");
    }
    req.kiosk = { id: kiosk.id, boothId: kiosk.boothId, boothCode: kiosk.booth.code };
    return true;
  }
}
