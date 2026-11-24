import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BoothsService } from "../booths/booths.service.js";
import { ApiError } from "../common/errors.js";
import { hashToken, newToken } from "../auth/tokens.js";
import { normalizeEnrollmentCode } from "../booths/codes.js";
import type { KioskHeartbeat, Pair } from "./kiosk.schemas.js";
import { verifyPassword } from "../auth/password.js";
import { signTicket } from "../devices/ticket.js";
import { StorageService } from "../storage/storage.service.js";

@Injectable()
export class KioskService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly booths: BoothsService, private readonly storage: StorageService) {}

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
    return this.issue(booth, meta, null);
  }

  /** "Open kiosk here": a signed-in booth admin or kiosk operator pairs this browser, no code needed. */
  async pairSignedIn(boothId: string, actor: string, meta: { ip?: string; userAgent?: string }) {
    const booth = await this.db.booth.findUnique({ where: { id: boothId }, select: { id: true, name: true, code: true, state: true } });
    if (!booth) throw new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Booth not found");
    if (booth.state === "REVOKED") throw new ApiError(HttpStatus.CONFLICT, "BOOTH_REVOKED", "This booth's access was revoked");
    return this.issue({ id: booth.id, name: booth.name, code: booth.code }, meta, actor);
  }

  private async issue(booth: { id: string; name: string; code: string }, meta: { ip?: string; userAgent?: string }, by: string | null) {
    const token = newToken();
    // One kiosk per booth: pairing a new browser signs the old one out.
    const [, kiosk] = await this.db.$transaction([
      this.db.kiosk.deleteMany({ where: { boothId: booth.id } }),
      this.db.kiosk.create({ data: { boothId: booth.id, tokenHash: hashToken(token), userAgent: meta.userAgent, lastSeenAt: new Date() } }),
    ]);
    await this.audit.record({ actor: by ?? `kiosk:${kiosk.id}`, action: "kiosk.pair", entityType: "booth", entityId: booth.id, ip: meta.ip, metadata: by ? { kioskId: kiosk.id, signedIn: true } : undefined });
    this.booths.push([booth.id]);
    return { token, booth };
  }

  /** A 5-minute ticket the kiosk hands to the agent on this computer to pair with it. */
  async agentTicket(boothId: string) {
    const device = await this.db.device.findUnique({ where: { boothId }, select: { localSecret: true } });
    if (!device) throw new ApiError(HttpStatus.NOT_FOUND, "NO_AGENT", "No agent is enrolled for this booth");
    if (!device.localSecret) throw new ApiError(HttpStatus.CONFLICT, "AGENT_TOO_OLD", "Re-enroll this booth's agent to enable kiosk pairing");
    return { ...signTicket(boothId, device.localSecret), boothId };
  }

  async staff(boothId: string, pin: string, ip?: string) {
    const b = await this.db.booth.findUniqueOrThrow({ where: { id: boothId }, select: { staffPinHash: true } });
    const ok = !!b.staffPinHash && await verifyPassword(b.staffPinHash, pin);
    await this.audit.record({ actor: `booth:${boothId}`, action: ok ? "kiosk.staff" : "kiosk.staff.failed", entityType: "booth", entityId: boothId, ip });
    if (!ok) throw new ApiError(HttpStatus.FORBIDDEN, "WRONG_PIN", "That PIN isn't right");
    return { ok: true };
  }

  async config(boothId: string) {
    const b = await this.booths.row(boothId);
    const live = b.events.find((eb) => eb.event.status === "ACTIVE")?.event;
    return { ...this.booths.deviceConfig(b), storage: this.storage.enabled, galleryRetentionDays: live?.config?.galleryRetentionDays ?? 30 };
  }

  async heartbeat(kioskId: string, boothId: string, hb: KioskHeartbeat, userAgent?: string) {
    await this.db.kiosk.update({
      where: { id: kioskId },
      data: { lastSeenAt: new Date(), lastError: hb.lastError ?? null, userAgent, telemetry: { camera: hb.camera, cameras: hb.cameras?.map((c) => ({ ...c, provider: "webcam" })), queue: hb.queue } },
    });
    this.booths.push([boothId]);
    return { configVersion: this.booths.deviceConfig(await this.booths.row(boothId)).version };
  }
}
