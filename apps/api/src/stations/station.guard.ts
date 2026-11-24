import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma.service.js";
import { hashToken } from "../auth/tokens.js";
import { ApiError } from "../common/errors.js";

export type StationReq = FastifyRequest & { station?: { id: string } };

// A station's computer authenticates like a booth's: "Authorization: Bearer pbd_…".
@Injectable()
export class StationGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<StationReq>();
    const token = /^Bearer (pbd_[A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "")?.[1];
    const station = token ? await this.db.station.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } }) : null;
    if (!station) throw new ApiError(HttpStatus.UNAUTHORIZED, "STATION_UNAUTHORIZED", "This computer isn't a station, or was signed out");
    req.station = station;
    return true;
  }
}
