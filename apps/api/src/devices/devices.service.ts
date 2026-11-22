import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BoothsService } from "../booths/booths.service.js";
import { CONFIG, type Config } from "../config.js";
import { ApiError } from "../common/errors.js";
import { hashToken } from "../auth/tokens.js";
import { newDeviceToken, normalizeEnrollmentCode } from "../booths/codes.js";
import type { Enroll, Heartbeat } from "./devices.schemas.js";
import { newLocalSecret } from "./ticket.js";

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly booths: BoothsService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Trade a one-time enrollment code for a device token. The token is returned once, never stored. */
  async enroll(body: Enroll, ip?: string) {
    if (body.simulated && !this.cfg.ALLOW_SIMULATED_BOOTHS) {
      throw new ApiError(HttpStatus.FORBIDDEN, "SIMULATION_DISABLED", "Simulated booths are disabled on this server");
    }
    const codeHash = hashToken(normalizeEnrollmentCode(body.code));
    const booth = await this.db.booth.findUnique({ where: { enrollmentCodeHash: codeHash }, select: { id: true, name: true, code: true } });
    // Claim the code atomically: of two devices racing with the same code, exactly one wins.
    const claimed = booth && (await this.db.booth.updateMany({
      where: { id: booth.id, enrollmentCodeHash: codeHash, enrollmentExpiresAt: { gt: new Date() } },
      data: { enrollmentCodeHash: null, enrollmentExpiresAt: null, state: "READY" },
    })).count === 1;
    if (!booth || !claimed) {
      await this.audit.record({ actor: "anonymous", action: "device.enroll.failed", ip });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CODE", "Enrollment code is wrong, used or expired");
    }

    const token = newDeviceToken();
    const localSecret = newLocalSecret();
    const d = body.device;
    // One device per booth: enrolling a new computer replaces the old one (its token dies with it).
    const [, device] = await this.db.$transaction([
      this.db.device.deleteMany({ where: { boothId: booth.id } }),
      this.db.device.create({
        data: { boothId: booth.id, tokenHash: hashToken(token), localSecret, identifier: d.identifier, hostname: d.hostname, os: d.os, agentVersion: d.agentVersion, simulated: body.simulated, lastIp: ip },
      }),
    ]);
    await this.audit.record({ actor: `device:${device.id}`, action: "device.enroll", entityType: "booth", entityId: booth.id, ip, metadata: { simulated: body.simulated, hostname: d.hostname ?? null } });
    this.booths.push([booth.id]);
    return { token, localSecret, booth, heartbeatIntervalSeconds: this.cfg.HEARTBEAT_INTERVAL_SECONDS };
  }

  async heartbeat(deviceId: string, boothId: string, hb: Heartbeat, ip?: string) {
    await this.db.device.update({
      where: { id: deviceId },
      data: {
        lastHeartbeatAt: new Date(),
        lastIp: ip,
        lastError: hb.lastError ?? null,
        ...(hb.agentVersion ? { agentVersion: hb.agentVersion } : {}),
        ...(hb.os ? { os: hb.os } : {}),
        ...(hb.hostname ? { hostname: hb.hostname } : {}),
        ...(hb.configVersion ? { appliedConfigVersion: hb.configVersion } : {}),
        telemetry: {
          storage: hb.storage, pendingUploads: hb.pendingUploads, pendingPrints: hb.pendingPrints,
          camera: hb.camera, printer: hb.printer, cameras: hb.cameras, printers: hb.printers, printJobs: hb.printJobs,
        },
      },
    });
    const booth = await this.booths.row(boothId);
    this.booths.push([boothId]);
    // The booth compares this with what it runs and fetches /devices/config when they differ.
    return { configVersion: this.booths.deviceConfig(booth).version, heartbeatIntervalSeconds: this.cfg.HEARTBEAT_INTERVAL_SECONDS, serverTime: new Date() };
  }

  async config(boothId: string) {
    return this.booths.deviceConfig(await this.booths.row(boothId));
  }

  async ack(deviceId: string, boothId: string, version: string) {
    await this.db.device.update({ where: { id: deviceId }, data: { appliedConfigVersion: version } });
    this.booths.push([boothId]);
    return { ok: true };
  }
}
