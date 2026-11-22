import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BoothsService } from "../booths/booths.service.js";
import { ApiError } from "../common/errors.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { normalizeEnrollmentCode } from "../booths/codes.js";
import type { KioskHeartbeat, Pair } from "./kiosk.schemas.js";

@Injectable()
export class KioskService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly booths: BoothsService) {}

  /** Pairs this browser with a booth. The code must belong to the booth in the URL. */
  async pair(body: Pair, meta: { ip?: string; userAgent?: string }) {
    const codeHash = hashToken(normalizeEnrollmentCode(body.code));
    const { count } = await this.db.booth.updateMany({
      where: { code: body.boothCode, kioskCodeHash: codeHash, kioskCodeExpiresAt: { gt: new Date() }, state: { not: "REVOKED" } },
      data: { kioskCodeHash: null, kioskCodeExpiresAt: null },
    });
    if (count !== 1) {
      await this.audit.record({ actor: "anonymous", action: "kiosk.pair.failed", ip: meta.ip, metadata: { boothCode: body.boothCode } });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CODE", "Pairing code is wrong, used or expired");
    }
    const booth = await this.db.booth.findUniqueOrThrow({ where: { code: body.boothCode }, select: { id: true, name: true, code: true } });
    const token = newToken();
    // One kiosk per booth: pairing a new browser signs the old one out.
    const [, kiosk] = await this.db.$transaction([
      this.db.kiosk.deleteMany({ where: { boothId: booth.id } }),
      this.db.kiosk.create({ data: { boothId: booth.id, tokenHash: hashToken(token), userAgent: meta.userAgent, lastSeenAt: new Date() } }),
    ]);
    await this.audit.record({ actor: `kiosk:${kiosk.id}`, action: "kiosk.pair", entityType: "booth", entityId: booth.id, ip: meta.ip });
    this.booths.push([booth.id]);
    return { token, booth };
  }

  async config(boothId: string) {
    return this.booths.deviceConfig(await this.booths.row(boothId));
  }

  async heartbeat(kioskId: string, boothId: string, hb: KioskHeartbeat, userAgent?: string) {
    await this.db.kiosk.update({
      where: { id: kioskId },
      data: { lastSeenAt: new Date(), lastError: hb.lastError ?? null, userAgent, telemetry: { camera: hb.camera, cameras: hb.cameras?.map((c) => ({ ...c, provider: "webcam" })) } },
    });
    this.booths.push([boothId]);
    return { configVersion: (await this.config(boothId)).version };
  }
}
