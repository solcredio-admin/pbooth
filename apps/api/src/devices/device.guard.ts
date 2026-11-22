import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma.service.js";
import { hashToken } from "../auth/tokens.js";
import { ApiError } from "../common/errors.js";

export type DeviceReq = FastifyRequest & { device?: { id: string; boothId: string } };

// Booth computers authenticate with "Authorization: Bearer pbd_…". Revoking a booth deletes its
// device row, so a revoked token fails here on the very next request.
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<DeviceReq>();
    const token = /^Bearer (pbd_[A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "")?.[1];
    const device = token ? await this.db.device.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, boothId: true, booth: { select: { state: true } } } }) : null;
    if (!device || device.booth.state === "REVOKED") {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "DEVICE_UNAUTHORIZED", "Device not enrolled or revoked");
    }
    req.device = { id: device.id, boothId: device.boothId };
    return true;
  }
}
