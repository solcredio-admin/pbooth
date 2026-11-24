import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BoothsService } from "../booths/booths.service.js";
import { newEnrollmentCode, newStationCode, normalizeEnrollmentCode } from "../booths/codes.js";
import { STATION_READY_SECONDS, stationOnline } from "../booths/status.js";
import { hashToken } from "../auth/tokens.js";
import { ApiError, notFound } from "../common/errors.js";
import { CONFIG, type Config } from "../config.js";
import type { Prisma } from "../generated/prisma/client.js";
import { RefundsService } from "../selfservice/refunds.service.js";
import { StorageService } from "../storage/storage.service.js";
import type { Poll, PrintRequest, Report, UpdateStation } from "./stations.schemas.js";

const ENROLLMENT_MINUTES = 30;
const MAX_REQUEUES = 6; // handed back this often: staff look at it
const STUCK_MS = 3 * 60_000; // a station holding one print this long isn't counted on: backups may step in
const HELD = { status: { in: ["CLAIMED", "PRINTING"] } } satisfies Prisma.PrintJobWhereInput;
const include = { booths: { include: { booth: { select: { id: true, name: true } } } } } as const satisfies Prisma.StationInclude;
type Row = Prisma.StationGetPayload<{ include: typeof include }>;
const jobInclude = { booth: { select: { name: true } }, event: { select: { name: true, timeZone: true } }, station: { select: { name: true } } } as const satisfies Prisma.PrintJobInclude;

/**
 * Print stations and the one line of jobs in front of each: oldest first, whichever booth sent it.
 *  FIXED booths use their first station that can print; a later one only steps in when the earlier ones
 *  can't (off, printer error, stuck), not when they're merely busy. ROTATE booths take turns.
 * A station asks before it prints (CLAIMED → PRINTING). Until then the job can go back in line by itself;
 * after that only if the station says nothing came out, so nothing prints twice by itself.
 */
@Injectable()
export class StationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Stations");
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly db: PrismaService, private readonly audit: AuditService, private readonly booths: BoothsService,
    private readonly refunds: RefundsService, private readonly storage: StorageService, @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), this.cfg.ALERT_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try { await this.release(); await this.expire(); } catch (e) { this.log.warn(`sweep failed: ${(e as Error).message}`); } finally { this.busy = false; }
  }

  /** Back in line, for any station (a higher attempt: whoever had it can't print it any more). */
  private async requeue(j: { id: string; attempt: number; requeues: number; tried: string[]; stationId: string | null }, error: string, status: ("CLAIMED" | "PRINTING")[]) {
    const { count } = await this.db.printJob.updateMany({
      where: { id: j.id, attempt: j.attempt, status: { in: status } },
      data: { status: "WAITING", stationId: null, claimedAt: null, attempt: j.attempt + 1, requeues: j.requeues + 1, error, notBefore: new Date(Date.now() + 10_000 * (j.requeues + 1)), tried: [...new Set([...j.tried, ...(j.stationId ? [j.stationId] : [])])] },
    });
    return count === 1;
  }

  /** A station went silent before it was told to print: the job goes back in line. */
  private async release() {
    const rows = await this.db.printJob.findMany({ where: { status: "CLAIMED", station: { lastPollAt: { lt: new Date(Date.now() - this.cfg.PRINT_RELEASE_SECONDS * 1000) } } }, include: { station: { select: { name: true } } }, take: 50 });
    for (const j of rows) await this.requeue(j, `${j.station?.name} went offline before printing it`, ["CLAIMED"]);
  }

  /** Stations that can print now, or will once they finish what they're printing. */
  private async able(now: number) {
    const rows = await this.db.station.findMany({
      where: { enabled: true, ready: true, lastPollAt: { gt: new Date(now - STATION_READY_SECONDS * 1000) }, jobs: { none: { ...HELD, claimedAt: { lt: new Date(now - STUCK_MS) } } } },
      select: { id: true, lastClaimAt: true, _count: { select: { jobs: { where: HELD } } } },
    });
    return new Map(rows.map((r) => [r.id, { free: r._count.jobs === 0, lastClaimAt: r.lastClaimAt?.getTime() ?? 0 }]));
  }

  /** Nobody could print it in time: give up, and flag the payment (if there was one) for a refund. */
  private async expire() {
    const rows = await this.db.printJob.findMany({ where: { status: "WAITING", expiresAt: { lt: new Date() } }, include: { event: { select: { id: true, name: true, kind: true } }, booth: { select: { stations: { select: { stationId: true } } } } }, take: 50 });
    const able = rows.length ? await this.able(Date.now()) : new Map();
    for (const j of rows) {
      // a long line that's still moving isn't a stuck one
      if (j.targetStationId ? able.has(j.targetStationId) : j.booth?.stations.some((s) => able.has(s.stationId))) continue;
      const { count } = await this.db.printJob.updateMany({ where: { id: j.id, status: "WAITING" }, data: { status: "EXPIRED", error: "No station could print it in time" } });
      if (!count) continue; // a station took it just now
      const p = await this.db.payment.findFirst({ where: { sessionId: j.id, status: "PAID", amountCentavos: { gt: 0 } }, select: { id: true } });
      if (p) await this.refunds.open(j.event, j.boothId, p.id, "NO_PRINT");
    }
  }

  // ---------- admin: stations ----------

  private dto(s: Row, busy: boolean, now = Date.now()) {
    return {
      id: s.id, name: s.name, code: s.code, enabled: s.enabled,
      printerName: s.printerName, paperSize: s.paperSize, orientation: s.orientation,
      online: stationOnline(s, now), ready: s.enabled && s.ready && stationOnline(s, now), busy,
      lastPollAt: s.lastPollAt, lastError: s.lastError,
      computer: s.tokenHash ? { hostname: s.hostname, os: s.os, agentVersion: s.agentVersion, simulated: s.simulated, enrolledAt: s.enrolledAt } : null,
      printers: (s.printers ?? []) as { name: string; isDefault?: boolean }[],
      enrollmentExpiresAt: s.enrollmentExpiresAt && s.enrollmentExpiresAt.getTime() > now ? s.enrollmentExpiresAt : null,
      booths: s.booths.map((b) => b.booth),
    };
  }

  private async toDto(s: Row) {
    return this.dto(s, (await this.db.printJob.count({ where: { stationId: s.id, status: { in: ["CLAIMED", "PRINTING"] } } })) > 0);
  }

  private async row(id: string) {
    const s = await this.db.station.findUnique({ where: { id }, include });
    if (!s) throw notFound("Station");
    return s;
  }

  /** Booths using this station get new config, and their admin pages refresh. */
  private pushBooths(s: Row) { this.booths.push(s.booths.map((b) => b.boothId)); }

  async list() {
    const [rows, busy] = await Promise.all([
      this.db.station.findMany({ include, orderBy: { name: "asc" }, take: 200 }),
      this.db.printJob.findMany({ where: { status: { in: ["CLAIMED", "PRINTING"] } }, select: { stationId: true }, distinct: ["stationId"] }),
    ]);
    const set = new Set(busy.map((b) => b.stationId));
    return { items: rows.map((s) => this.dto(s, set.has(s.id))) };
  }

  async get(id: string) { return this.toDto(await this.row(id)); }

  async create(name: string, actor: string, ip?: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const s = await this.db.station.create({ data: { name, code: newStationCode() }, include });
        await this.audit.record({ actor, action: "station.create", entityType: "station", entityId: s.id, ip });
        return this.dto(s, false);
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
    throw new ApiError(HttpStatus.CONFLICT, "CODE_COLLISION", "Couldn't generate a unique station code; try again");
  }

  async update(id: string, body: UpdateStation, actor: string, ip?: string) {
    await this.row(id);
    const s = await this.db.station.update({ where: { id }, data: { ...body, ...(body.printerName === "" ? { printerName: null } : {}) }, include });
    await this.audit.record({ actor, action: "station.update", entityType: "station", entityId: id, ip, metadata: { fields: Object.keys(body) } });
    this.pushBooths(s);
    return this.toDto(s);
  }

  async enrollmentCode(id: string, actor: string, ip?: string) {
    await this.row(id);
    const code = newEnrollmentCode();
    const expiresAt = new Date(Date.now() + ENROLLMENT_MINUTES * 60_000);
    await this.db.station.update({ where: { id }, data: { enrollmentCodeHash: hashToken(normalizeEnrollmentCode(code)), enrollmentExpiresAt: expiresAt } });
    await this.audit.record({ actor, action: "station.enrollment-code", entityType: "station", entityId: id, ip });
    return { code, expiresAt };
  }

  /** Its computer is signed out at once. What it had taken may or may not have printed: a person checks. */
  async signOut(id: string, actor: string, ip?: string) {
    const s = await this.row(id);
    await this.db.$transaction([
      this.db.station.update({ where: { id }, data: { tokenHash: null, identifier: null, ready: false, enrollmentCodeHash: null, enrollmentExpiresAt: null } }),
      this.db.printJob.updateMany({ where: { stationId: id, status: { in: ["CLAIMED", "PRINTING"] } }, data: { status: "FAILED", error: "The station's computer was signed out. Check the printer before printing again." } }),
    ]);
    await this.audit.record({ actor, action: "station.sign-out", entityType: "station", entityId: id, ip });
    this.pushBooths(s);
    return this.get(id);
  }

  async remove(id: string, confirmName: string, actor: string, ip?: string) {
    const s = await this.row(id);
    if (confirmName.trim() !== s.name.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, "CONFIRM_MISMATCH", "Type the station's name exactly to delete it");
    await this.db.$transaction([
      this.db.printJob.updateMany({ where: { stationId: id, status: { in: ["CLAIMED", "PRINTING"] } }, data: { status: "FAILED", error: "The station was deleted. Check the printer before printing again." } }),
      this.db.printJob.updateMany({ where: { targetStationId: id }, data: { targetStationId: null } }),
      this.db.station.delete({ where: { id } }),
    ]);
    await this.audit.record({ actor, action: "station.delete", entityType: "station", entityId: id, ip, metadata: { name: s.name, code: s.code } });
    this.pushBooths(s);
    return { deleted: true };
  }

  /** Which stations a booth prints to, first choice first. */
  async setForBooth(boothId: string, stationIds: string[], mode: "FIXED" | "ROTATE" | undefined, actor: string, ip?: string) {
    await this.booths.row(boothId);
    if ((await this.db.station.count({ where: { id: { in: stationIds } } })) !== stationIds.length) throw notFound("Station");
    const before = await this.db.boothStation.findMany({ where: { boothId }, select: { stationId: true } });
    const shared = await this.db.boothStation.findMany({ where: { stationId: { in: [...stationIds, ...before.map((x) => x.stationId)] } }, select: { boothId: true } });
    await this.db.$transaction([
      this.db.boothStation.deleteMany({ where: { boothId } }),
      this.db.boothStation.createMany({ data: stationIds.map((stationId, position) => ({ boothId, stationId, position })) }),
      ...(mode ? [this.db.booth.update({ where: { id: boothId }, data: { printMode: mode } })] : []),
    ]);
    await this.audit.record({ actor, action: "booth.stations", entityType: "booth", entityId: boothId, ip, metadata: { stationIds, mode } });
    this.booths.push([...new Set([boothId, ...shared.map((x) => x.boothId)])]); // sharing a station changes how the others print too
    return this.booths.get(boothId);
  }

  // ---------- admin: jobs ----------

  async jobs(q: { status: "open" | "done"; stationId?: string }) {
    const rows = await this.db.printJob.findMany({
      where: {
        status: { in: q.status === "open" ? ["WAITING", "CLAIMED", "PRINTING", "FAILED", "EXPIRED"] : ["DONE"] },
        ...(q.status === "open" ? { createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } } : {}),
        ...(q.stationId ? { OR: [{ stationId: q.stationId }, { targetStationId: q.stationId }] } : {}),
      },
      include: jobInclude, orderBy: { createdAt: "desc" }, take: 100,
    });
    return { items: rows };
  }

  private async job(id: string) {
    const j = await this.db.printJob.findUnique({ where: { id } });
    if (!j) throw notFound("Print");
    return j;
  }

  /** Print a failed job again on the station that had it. */
  async retry(id: string, actor: string, ip?: string) {
    const j = await this.job(id);
    const s = j.stationId ? await this.db.station.findUnique({ where: { id: j.stationId }, select: { tokenHash: true } }) : null;
    if (j.status !== "FAILED" || !s?.tokenHash) throw new ApiError(HttpStatus.CONFLICT, "NOT_RETRYABLE", "Only a failed print can be tried again on its station. Move it to a station instead");
    const { count } = await this.db.printJob.updateMany({ where: { id, status: "FAILED", attempt: j.attempt }, data: { status: "WAITING", targetStationId: j.stationId, stationId: null, attempt: j.attempt + 1, requeues: 0, notBefore: null, error: null, claimedAt: null, expiresAt: this.deadline() } });
    if (!count) throw new ApiError(HttpStatus.CONFLICT, "CHANGED", "This print just changed. Look again");
    await this.audit.record({ actor, action: "print.retry", entityType: "print", entityId: id, ip });
    return { ok: true };
  }

  /** Send a job to one station. If another station already has it, that one may be printing it: confirm first. */
  async move(id: string, stationId: string, confirm: boolean, actor: string, ip?: string) {
    const j = await this.job(id);
    const to = await this.row(stationId);
    if (j.status === "DONE") throw new ApiError(HttpStatus.CONFLICT, "ALREADY_PRINTED", "This one already printed");
    const held = j.status === "PRINTING"; // only claimed: not allowed to print yet, so it just moves
    if ((held || j.status === "CLAIMED") && j.stationId === stationId) throw new ApiError(HttpStatus.CONFLICT, "ALREADY_THERE", `${to.name} already has it`);
    if (held && !confirm) throw new ApiError(HttpStatus.CONFLICT, "MAY_PRINT_TWICE", "Another station already has this print and may be printing it. Moving it can print it twice");
    const { count } = await this.db.printJob.updateMany({
      where: { id, status: j.status, attempt: j.attempt },
      data: { status: "WAITING", stationId: null, targetStationId: stationId, attempt: j.attempt + 1, requeues: 0, notBefore: null, error: null, claimedAt: null, expiresAt: this.deadline() },
    });
    if (!count) throw new ApiError(HttpStatus.CONFLICT, "CHANGED", "This print just changed. Look again");
    await this.audit.record({ actor, action: "print.move", entityType: "print", entityId: id, ip, metadata: { from: j.stationId, to: stationId, status: j.status } });
    return { ok: true };
  }

  // ---------- the kiosk ----------

  private deadline() { return new Date(Date.now() + this.cfg.PRINT_WAIT_MINUTES * 60_000); }

  /** Idempotent: the session id is the print's id. */
  async request(boothId: string, b: PrintRequest) {
    const session = await this.db.session.findUnique({ where: { id: b.sessionId }, include: { event: { include: { config: true } } } });
    if (!session) throw new ApiError(HttpStatus.CONFLICT, "SESSION_UNKNOWN", "Session not recorded yet; retry shortly");
    if (session.boothId !== boothId) throw new ApiError(HttpStatus.FORBIDDEN, "WRONG_BOOTH", "This session belongs to another booth");
    const existing = await this.db.printJob.findUnique({ where: { id: b.sessionId } });
    if (!existing) {
      const { event } = session;
      if (!event.config?.printEnabled || (event.kind === "SELF_SERVICE" && event.freeSessions)) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "PRINTING_OFF", "This event doesn't print");
      const photo = await this.db.photo.findFirst({ where: { id: b.photoId, sessionId: b.sessionId, kind: "DESIGN" }, select: { status: true } });
      if (!photo || photo.status === "PENDING") throw new ApiError(HttpStatus.CONFLICT, "PHOTO_UNKNOWN", "The photo hasn't arrived yet; retry shortly");
      if (photo.status === "FAILED" || photo.status === "DELETED") throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "PHOTO_GONE", "That photo can't be printed");
      if (!(await this.db.boothStation.count({ where: { boothId } }))) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "NO_STATIONS", "No station is linked to this booth");
      await this.db.printJob.createMany({
        data: { id: b.sessionId, boothId, eventId: session.eventId, photoId: b.photoId, copies: Math.min(5, Math.max(1, event.config.printCopies)), strip: b.strip, expiresAt: this.deadline() },
        skipDuplicates: true,
      });
    }
    return this.status(boothId, b.sessionId);
  }

  async status(boothId: string, id: string) {
    const j = await this.db.printJob.findFirst({ where: { id, boothId }, include: { station: { select: { name: true } } } });
    if (!j) throw notFound("Print");
    const ids = j.targetStationId ? [j.targetStationId] : (await this.db.boothStation.findMany({ where: { boothId }, select: { stationId: true } })).map((x) => x.stationId);
    const ahead = j.status !== "WAITING" ? 0 : await this.db.printJob.count({
      where: { id: { not: id }, createdAt: { lt: j.createdAt }, OR: [{ status: "PRINTING", stationId: { in: ids } }, { status: { in: ["WAITING", "CLAIMED"] }, booth: { stations: { some: { stationId: { in: ids } } } } }] },
    });
    return { id, status: j.status, station: j.station?.name ?? null, ahead };
  }

  // ---------- the station's computer ----------

  /**
   * Every couple of seconds: "I'm here". Takes a waiting job if this station is free and ready, and
   * returns everything it holds, so a lost answer or a restart just asks again.
   */
  async poll(id: string, b: Poll) {
    const now = new Date();
    const s = await this.db.station.update({
      where: { id },
      data: { lastPollAt: now, ready: b.ready, lastError: b.error, printers: b.printers, ...(b.agentVersion ? { agentVersion: b.agentVersion } : {}), ...(b.os ? { os: b.os } : {}), ...(b.hostname ? { hostname: b.hostname } : {}) },
    });
    const mine = () => this.db.printJob.findMany({ where: { stationId: id, status: { in: ["CLAIMED", "PRINTING"] } }, orderBy: { claimedAt: "asc" } });
    let held = await mine();
    if (!held.length && s.enabled && b.ready && this.storage.enabled && await this.claim(id, now)) held = await mine();
    const photos = new Map((await this.db.photo.findMany({ where: { id: { in: held.map((j) => j.photoId) }, status: { not: "DELETED" } }, select: { id: true, key: true, sha256: true } })).map((p) => [p.id, p]));
    const jobs = [];
    for (const j of held) {
      const p = photos.get(j.photoId);
      if (p) jobs.push({ id: j.id, attempt: j.attempt, status: j.status, copies: j.copies, strip: j.strip, backup: await this.hasBackup(j, id, now.getTime()), sha256: p.sha256, url: await this.storage.presignGet(p.key) });
      // deleted meanwhile: it must not hold up the line
      else await this.db.printJob.updateMany({ where: { id: j.id, attempt: j.attempt, status: { in: ["CLAIMED", "PRINTING"] } }, data: { status: "FAILED", error: "The photo was deleted" } });
    }
    return { station: { id: s.id, name: s.name, code: s.code, enabled: s.enabled, printerName: s.printerName, paperSize: s.paperSize, orientation: s.orientation }, jobs };
  }

  /** Another station could print this if this one hands it back (asked only while its printer has a problem). */
  private async hasBackup(j: { boothId: string | null; targetStationId: string | null }, id: string, now: number) {
    if (!j.boothId || j.targetStationId) return false;
    const others = await this.db.boothStation.findMany({ where: { boothId: j.boothId, stationId: { not: id } }, select: { stationId: true } });
    if (!others.length) return false;
    const able = await this.able(now);
    return others.some((o) => able.has(o.stationId));
  }

  private async claim(id: string, now: Date) {
    const waiting = await this.db.printJob.findMany({
      where: { status: "WAITING", OR: [{ targetStationId: id }, { targetStationId: null, booth: { stations: { some: { stationId: id } } } }] },
      include: { booth: { select: { printMode: true, stations: { orderBy: { position: "asc" }, select: { stationId: true } } } } }, orderBy: { createdAt: "asc" }, take: 200,
    });
    if (!waiting.length) return false;
    const able = await this.able(now.getTime());
    const mine = able.get(id)?.lastClaimAt ?? 0;
    for (const j of waiting) {
      if (j.notBefore && j.notBefore > now && j.tried.includes(id)) continue;
      if (j.targetStationId !== id && this.belongsToAnother(id, mine, j, able)) continue;
      // The station row is the lock: two answers to one station can't both give it a job.
      const got = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Station" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (await tx.printJob.count({ where: { stationId: id, ...HELD } })) return "busy" as const;
        const { count } = await tx.printJob.updateMany({ where: { id: j.id, status: "WAITING", attempt: j.attempt }, data: { status: "CLAIMED", stationId: id, claimedAt: new Date(), error: null } });
        if (count) await tx.station.update({ where: { id }, data: { lastClaimAt: new Date() } });
        return count ? "got" as const : "gone" as const;
      });
      if (got !== "gone") return true;
    }
    return false;
  }

  private belongsToAnother(id: string, mine: number, j: { tried: string[]; booth: { printMode: "FIXED" | "ROTATE"; stations: { stationId: string }[] } | null }, able: Map<string, { free: boolean; lastClaimAt: number }>) {
    const all = j.booth?.stations.map((x) => x.stationId) ?? [];
    const fresh = all.filter((x) => !j.tried.includes(x) && able.has(x));
    // It was handed back here: somebody else who can print goes first.
    if (j.tried.includes(id)) { if (fresh.length) return true; return all.slice(0, all.indexOf(id)).some((x) => able.has(x)); }
    if (j.booth?.printMode === "ROTATE") return fresh.some((x) => x !== id && able.get(x)!.free && (able.get(x)!.lastClaimAt < mine || (able.get(x)!.lastClaimAt === mine && x < id)));
    return fresh.some((x) => all.indexOf(x) < all.indexOf(id));
  }

  async report(id: string, jobId: string, b: Report) {
    if (b.status === "FAILED" && b.safe) {
      const j = await this.db.printJob.findFirst({ where: { id: jobId, stationId: id, attempt: b.attempt } });
      if (j && j.requeues < MAX_REQUEUES && await this.requeue(j, b.error ?? "Handed back", ["CLAIMED", "PRINTING"])) return { ok: true };
    }
    const { count } = await this.db.printJob.updateMany({
      where: { id: jobId, stationId: id, attempt: b.attempt, status: { in: b.status === "PRINTING" ? ["CLAIMED"] : ["CLAIMED", "PRINTING"] } },
      data: { status: b.status, error: b.error, ...(b.status === "DONE" ? { doneAt: new Date() } : {}) },
    });
    if (count) return { ok: true };
    throw new ApiError(HttpStatus.CONFLICT, "NOT_YOURS", "This print is finished or was moved");
  }
}
