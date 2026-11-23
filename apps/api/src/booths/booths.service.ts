import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { CONFIG, type Config } from "../config.js";
import { ApiError, notFound } from "../common/errors.js";
import { hashToken } from "../auth/tokens.js";
import { type Prisma } from "../generated/prisma/client.js";
import { cameraSchema, DEFAULT_CAMERA, DEFAULT_PRINTER, printerSchema, type CreateBooth, type UpdateBooth } from "./booths.schemas.js";
import { newBoothCode, newEnrollmentCode, normalizeEnrollmentCode } from "./codes.js";
import { boothStatus, isOnline } from "./status.js";

export const boothInclude = {
  device: true,
  kiosk: true,
  events: { include: { event: { include: { config: true } } }, orderBy: { event: { startsAt: "asc" } } },
} as const satisfies Prisma.BoothInclude;
export type BoothRow = Prisma.BoothGetPayload<{ include: typeof boothInclude }>;

const ENROLLMENT_MINUTES = 30;
const SWEEP_MS = 15_000;

export interface KioskTelemetry {
  camera?: { status: string; name?: string; resolution?: string };
  queue?: { pending: number; failed: number; lastSyncAt: string | null };
  cameras?: { id: string; name: string; provider: string }[];
}

export interface Telemetry {
  storage?: { freeBytes: number; totalBytes: number };
  pendingUploads?: number;
  pendingPrints?: number;
  camera?: { status: string; name?: string; compatibility?: string; model?: string };
  printer?: { status: string; name?: string };
  printJobs?: { queued: number; failed: number; completedToday: number };
  cameras?: { id: string; name: string; provider: string }[];
  printers?: { name: string; isDefault?: boolean }[];
}

@Injectable()
export class BoothsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Booths");
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---------- what a booth should be running ----------

  /** The config a booth's device must apply. Its version changes whenever anything in it changes. */
  deviceConfig(b: BoothRow) {
    const live = b.events.map((eb) => eb.event).find((e) => e.status === "ACTIVE") ?? null;
    const c = live?.config;
    const payload = {
      booth: { id: b.id, name: b.name, code: b.code },
      camera: cameraSchema.parse(b.camera ?? {}),
      printer: printerSchema.parse(b.printer ?? {}),
      heartbeatIntervalSeconds: this.cfg.HEARTBEAT_INTERVAL_SECONDS,
      event: live ? {
        id: live.id, name: live.name, timeZone: live.timeZone, startsAt: live.startsAt.toISOString(), endsAt: live.endsAt.toISOString(),
        selfService: live.kind === "SELF_SERVICE" ? { priceCentavos: live.priceCentavos, currency: live.currency, freeSessions: live.freeSessions, vouchers: live.acceptVouchers, qr: live.acceptQr && !!this.cfg.PAYMONGO_SECRET_KEY } : null,
        guest: c ? {
          welcomeTitle: c.welcomeTitle, welcomeMessage: c.welcomeMessage, primaryColor: c.primaryColor, accentColor: c.accentColor,
          countdownSeconds: c.countdownSeconds, shotsPerSession: c.shotsPerSession, captureIntervalSeconds: c.captureIntervalSeconds, previewSeconds: c.previewSeconds,
          // a free self-service session is QR only: never printed
          printEnabled: c.printEnabled && !(live.kind === "SELF_SERVICE" && live.freeSessions), printCopies: c.printCopies, galleryEnabled: c.galleryEnabled, saveOriginals: c.saveOriginals,
          template: { layout: c.layout, footerText: c.footerText || live.name, showDate: c.showDate, pattern: c.pattern, frameStyle: c.frameStyle, photoStyle: c.photoStyle, fontStyle: c.fontStyle },
        } : null,
      } : null,
    };
    const version = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
    return { version, ...payload };
  }

  toDto(b: BoothRow, now = new Date()) {
    const d = b.device;
    const k = b.kiosk;
    // A booth is "seen" when either its agent or its kiosk browser checks in (webcam booths
    // have no agent until Phase 4).
    const seen = [d?.lastHeartbeatAt, k?.lastSeenAt].filter((x): x is Date => !!x).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    const lastError = d?.lastError ?? k?.lastError ?? null;
    const live = b.events.find((eb) => eb.event.status === "ACTIVE")?.event ?? null;
    const upcoming = b.events.map((eb) => eb.event).filter((e) => e.status === "DRAFT" || e.status === "SCHEDULED");
    const config = this.deviceConfig(b);
    return {
      id: b.id, name: b.name, code: b.code, notes: b.notes, state: b.state,
      status: boothStatus({ state: b.state, hasDevice: !!d || !!k, lastHeartbeatAt: seen, lastError, hasLiveEvent: !!live }, this.cfg.BOOTH_OFFLINE_AFTER_SECONDS, now),
      online: isOnline(seen, this.cfg.BOOTH_OFFLINE_AFTER_SECONDS, now),
      lastSeenAt: seen,
      lastError,
      simulated: d?.simulated ?? false,
      camera: config.camera,
      printer: config.printer,
      configVersion: config.version,
      configApplied: !!d && d.appliedConfigVersion === config.version,
      device: d ? {
        hostname: d.hostname, os: d.os, agentVersion: d.agentVersion, identifier: d.identifier, enrolledAt: d.enrolledAt,
        lastHeartbeatAt: d.lastHeartbeatAt, lastError: d.lastError, appliedConfigVersion: d.appliedConfigVersion,
        telemetry: (d.telemetry ?? {}) as Telemetry,
      } : null,
      kiosk: k ? {
        pairedAt: k.pairedAt, lastSeenAt: k.lastSeenAt, userAgent: k.userAgent, lastError: k.lastError,
        online: isOnline(k.lastSeenAt, this.cfg.BOOTH_OFFLINE_AFTER_SECONDS, now),
        telemetry: (k.telemetry ?? {}) as KioskTelemetry,
      } : null,
      kioskCodeExpiresAt: b.kioskCodeExpiresAt && b.kioskCodeExpiresAt > now ? b.kioskCodeExpiresAt : null,
      liveEvent: live ? { id: live.id, name: live.name } : null,
      events: b.events.map(({ event: e }) => ({ id: e.id, name: e.name, status: e.status, startsAt: e.startsAt, timeZone: e.timeZone })),
      nextEvent: upcoming[0] ? { id: upcoming[0].id, name: upcoming[0].name, startsAt: upcoming[0].startsAt } : null,
      enrollmentExpiresAt: b.enrollmentExpiresAt && b.enrollmentExpiresAt > now ? b.enrollmentExpiresAt : null,
      offlineAfterSeconds: this.cfg.BOOTH_OFFLINE_AFTER_SECONDS,
      createdAt: b.createdAt,
    };
  }

  // ---------- admin operations ----------

  async list() {
    // shortcut: no paging; one admin runs a handful of booths. Add paging past ~200.
    const rows = await this.db.booth.findMany({ include: boothInclude, orderBy: { name: "asc" }, take: 200 });
    return { items: rows.map((b) => this.toDto(b)) };
  }

  async get(id: string) {
    return this.toDto(await this.row(id));
  }

  async create(body: CreateBooth, actor: string, ip?: string) {
    // Booth codes are short; retry the rare collision instead of failing.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const b = await this.db.booth.create({
          data: { name: body.name, notes: body.notes || null, code: newBoothCode(), camera: DEFAULT_CAMERA, printer: DEFAULT_PRINTER },
          include: boothInclude,
        });
        await this.audit.record({ actor, action: "booth.create", entityType: "booth", entityId: b.id, ip });
        this.push([b.id]);
        return this.toDto(b);
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
    throw new ApiError(HttpStatus.CONFLICT, "CODE_COLLISION", "Couldn't generate a unique booth code; try again");
  }

  async update(id: string, body: UpdateBooth, actor: string, ip?: string) {
    await this.row(id);
    const b = await this.db.booth.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        ...(body.camera ? { camera: body.camera } : {}),
        ...(body.printer ? { printer: body.printer } : {}),
      },
      include: boothInclude,
    });
    await this.audit.record({ actor, action: "booth.update", entityType: "booth", entityId: id, ip, metadata: { fields: Object.keys(body) } });
    this.push([id]);
    return this.toDto(b);
  }

  /** New one-time code; shown once, stored hashed. Replaces any earlier unused code. */
  async enrollmentCode(id: string, actor: string, ip?: string) {
    await this.row(id);
    const code = newEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_MINUTES * 60_000);
    await this.db.booth.update({ where: { id }, data: { enrollmentCodeHash: hashToken(normalizeEnrollmentCode(code)), enrollmentExpiresAt: expiresAt } });
    await this.audit.record({ actor, action: "booth.enrollment-code", entityType: "booth", entityId: id, ip });
    this.push([id]);
    return { code, expiresAt };
  }

  /** One-time code to pair the booth's kiosk browser. Same format and lifetime as enrollment codes. */
  async kioskCode(id: string, actor: string, ip?: string) {
    const b = await this.row(id);
    if (b.state === "REVOKED") throw new ApiError(HttpStatus.CONFLICT, "BOOTH_REVOKED", "This booth is revoked. Enroll it again first.");
    const code = newEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_MINUTES * 60_000);
    await this.db.booth.update({ where: { id }, data: { kioskCodeHash: hashToken(normalizeEnrollmentCode(code)), kioskCodeExpiresAt: expiresAt } });
    await this.audit.record({ actor, action: "booth.kiosk-code", entityType: "booth", entityId: id, ip });
    this.push([id]);
    return { code, expiresAt };
  }

  /** Signs the kiosk browser out; it shows the pairing screen on its next request. */
  async unpairKiosk(id: string, actor: string, ip?: string) {
    await this.row(id);
    await this.db.kiosk.deleteMany({ where: { boothId: id } });
    await this.audit.record({ actor, action: "booth.kiosk-unpair", entityType: "booth", entityId: id, ip });
    this.push([id]);
    return this.get(id);
  }

  /** Withdraws device access at once: the device's token stops working on its next request. */
  async revoke(id: string, actor: string, ip?: string) {
    await this.row(id);
    await this.db.$transaction([
      this.db.device.deleteMany({ where: { boothId: id } }),
      this.db.kiosk.deleteMany({ where: { boothId: id } }),
      this.db.booth.update({ where: { id }, data: { state: "REVOKED", enrollmentCodeHash: null, enrollmentExpiresAt: null, kioskCodeHash: null, kioskCodeExpiresAt: null } }),
    ]);
    await this.audit.record({ actor, action: "booth.revoke", entityType: "booth", entityId: id, ip });
    this.push([id]);
    return this.get(id);
  }

  /**
   * Deletes the booth, its device and kiosk pairing, and its event bookings. Sessions and photos it
   * shot stay with their events. The caller must type the booth's exact name; a booth booked on a
   * live event can't be deleted.
   */
  async remove(id: string, confirmName: string, actor: string, ip?: string) {
    const b = await this.row(id);
    if (confirmName.trim() !== b.name.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, "CONFIRM_MISMATCH", "Type the booth's name exactly to delete it");
    const live = await this.db.eventBooth.findFirst({ where: { boothId: id, event: { status: "ACTIVE" } }, select: { event: { select: { name: true } } } });
    if (live) throw new ApiError(HttpStatus.CONFLICT, "BOOTH_LIVE", `This booth is serving "${live.event.name}" right now. Wrap up the event or take the booth off it first`);
    await this.db.booth.delete({ where: { id } });
    await this.audit.record({ actor, action: "booth.delete", entityType: "booth", entityId: id, ip, metadata: { name: b.name, code: b.code } });
    this.realtime.boothsChanged({ booths: [], removed: [id] });
    return { deleted: true };
  }

  // ---------- event assignment ----------

  async boothsForEvent(eventId: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw notFound("Event");
    const rows = await this.db.booth.findMany({ where: { events: { some: { eventId } } }, include: boothInclude, orderBy: { name: "asc" } });
    return { items: rows.map((b) => this.toDto(b)) };
  }

  async assign(eventId: string, boothId: string, actor: string, ip?: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) throw notFound("Event");
    if (event.status === "ARCHIVED" || event.status === "COMPLETED") {
      throw new ApiError(HttpStatus.CONFLICT, "EVENT_CLOSED", "Booths can't be added to a completed or archived event");
    }
    const booth = await this.row(boothId);
    if (booth.state === "REVOKED") throw new ApiError(HttpStatus.CONFLICT, "BOOTH_REVOKED", "This booth is revoked. Enroll it again first.");
    if (event.status === "ACTIVE") await this.assertFree([boothId], eventId);
    await this.db.eventBooth.upsert({ where: { eventId_boothId: { eventId, boothId } }, create: { eventId, boothId }, update: {} });
    await this.audit.record({ actor, action: "event.booth.assign", entityType: "event", entityId: eventId, ip, metadata: { boothId } });
    this.push([boothId]);
    return this.boothsForEvent(eventId);
  }

  async unassign(eventId: string, boothId: string, actor: string, ip?: string) {
    const { count } = await this.db.eventBooth.deleteMany({ where: { eventId, boothId } });
    if (count === 0) throw notFound("Assignment");
    await this.audit.record({ actor, action: "event.booth.unassign", entityType: "event", entityId: eventId, ip, metadata: { boothId } });
    this.push([boothId]);
    return this.boothsForEvent(eventId);
  }

  /** A booth can serve only one live event. Throws 409 naming the booths that are busy elsewhere. */
  async assertFree(boothIds: string[], exceptEventId: string) {
    const busy = await this.db.eventBooth.findMany({
      where: { boothId: { in: boothIds }, eventId: { not: exceptEventId }, event: { status: "ACTIVE" } },
      include: { booth: { select: { name: true } }, event: { select: { name: true } } },
    });
    if (busy.length) {
      const list = busy.map((b) => `${b.booth.name} (live at ${b.event.name})`).join(", ");
      throw new ApiError(HttpStatus.CONFLICT, "BOOTH_BUSY", `Already serving another live event: ${list}`);
    }
  }

  // ---------- realtime ----------

  /** Re-read these booths and push them to open admin pages. Never throws. */
  push(ids: string[]) {
    if (!ids.length) return;
    this.db.booth.findMany({ where: { id: { in: ids } }, include: boothInclude })
      .then((rows) => this.realtime.boothsChanged({ booths: rows.map((b) => this.toDto(b)) }))
      .catch((e) => this.log.warn(`push failed: ${(e as Error).message}`));
  }

  async pushForEvent(eventId: string) {
    const rows = await this.db.eventBooth.findMany({ where: { eventId }, select: { boothId: true } });
    this.push(rows.map((r) => r.boothId));
  }

  // Nobody sends "I went offline", so every 15 s push booths whose last heartbeat just aged out.
  onModuleInit() {
    this.sweeper = setInterval(async () => {
      try {
        const edge = Date.now() - this.cfg.BOOTH_OFFLINE_AFTER_SECONDS * 1000;
        const window = { lte: new Date(edge), gt: new Date(edge - SWEEP_MS - 5_000) };
        const [devices, kiosks] = await Promise.all([
          this.db.device.findMany({ where: { lastHeartbeatAt: window }, select: { boothId: true } }),
          this.db.kiosk.findMany({ where: { lastSeenAt: window }, select: { boothId: true } }),
        ]);
        this.push([...new Set([...devices, ...kiosks].map((r) => r.boothId))]);
      } catch (e) {
        this.log.warn(`sweep failed: ${(e as Error).message}`);
      }
    }, SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }

  async row(id: string) {
    const b = await this.db.booth.findUnique({ where: { id }, include: boothInclude });
    if (!b) throw notFound("Booth");
    return b;
  }
}
