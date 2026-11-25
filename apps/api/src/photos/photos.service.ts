import { createHash, randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import sharp from "sharp";
import { ZipArchive } from "archiver";
import type { Writable } from "node:stream";
import { PrismaService } from "../prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CONFIG, type Config } from "../config.js";
import { ApiError, notFound } from "../common/errors.js";
import type { PhotoKind } from "../generated/prisma/client.js";

const WORK_MS = 2000;
const MAX_ATTEMPTS = 3;
const MAX_PIXELS = 12000;

export const newGalleryToken = () => randomBytes(32).toString("base64url");

@Injectable()
export class PhotosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Photos");
  private timers: NodeJS.Timeout[] = [];
  private working = false;

  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private requireStorage() {
    if (!this.storage.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_NOT_CONFIGURED", "Photo storage isn't set up yet");
  }

  // ---------- upload ----------

  /** Step 1: a signed, single-object upload link bound to this file's size and checksum. Idempotent. */
  async authorize(boothId: string, b: { photoId: string; sessionId: string; kind: PhotoKind; index: number; sha256: string; size: number; contentType: string }) {
    this.requireStorage();
    if (b.size > this.cfg.MAX_PHOTO_MB * 1024 * 1024) throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, "TOO_LARGE", `Photos are limited to ${this.cfg.MAX_PHOTO_MB} MB`);
    const session = await this.db.session.findUnique({ where: { id: b.sessionId }, select: { boothId: true, eventId: true, event: { select: { config: { select: { saveOriginals: true } } } } } });
    // The session start may still be on its way (the kiosk sends both in the background): retry later.
    if (!session) throw new ApiError(HttpStatus.CONFLICT, "SESSION_UNKNOWN", "Session not recorded yet; retry shortly");
    if (session.boothId !== boothId) throw new ApiError(HttpStatus.FORBIDDEN, "WRONG_BOOTH", "This session belongs to another booth");
    // Designs-only events keep storage small: individual shots are refused, whatever the kiosk sends.
    if (b.kind === "ORIGINAL" && !session.event.config?.saveOriginals) {
      throw new ApiError(HttpStatus.CONFLICT, "ORIGINALS_OFF", "This event saves only the finished design");
    }

    const existing = await this.db.photo.findUnique({ where: { id: b.photoId } });
    if (existing) {
      if (existing.sha256 !== b.sha256 || existing.sessionId !== b.sessionId) throw new ApiError(HttpStatus.CONFLICT, "PHOTO_CONFLICT", "A different file was already registered with this id");
      if (existing.status !== "PENDING" && existing.status !== "FAILED") return { photoId: existing.id, alreadyUploaded: true };
    } else {
      await this.db.photo.create({
        data: {
          id: b.photoId, sessionId: b.sessionId, eventId: session.eventId, boothId, kind: b.kind, index: b.index,
          contentType: b.contentType, sizeBytes: b.size, sha256: b.sha256,
          key: `events/${session.eventId}/sessions/${b.sessionId}/${b.photoId}.jpg`,
        },
      });
    }
    const photo = await this.db.photo.findUniqueOrThrow({ where: { id: b.photoId } });
    if (photo.status === "FAILED") await this.db.photo.update({ where: { id: photo.id }, data: { status: "PENDING", error: null, attempts: 0 } });
    return { photoId: photo.id, alreadyUploaded: false, ...(await this.storage.presignPut(photo.key, { contentType: photo.contentType, size: photo.sizeBytes, sha256Hex: photo.sha256 })) };
  }

  /** Step 2: confirm the object is really there, with the promised size and checksum. Idempotent. */
  async complete(boothId: string, photoId: string) {
    this.requireStorage();
    const p = await this.db.photo.findUnique({ where: { id: photoId } });
    if (!p || p.boothId !== boothId) throw notFound("Photo");
    if (p.status !== "PENDING") return { photoId, status: p.status };
    const head = await this.storage.head(p.key);
    if (!head) throw new ApiError(HttpStatus.CONFLICT, "NOT_UPLOADED", "The file hasn't arrived in storage yet");
    if (head.size !== p.sizeBytes || (head.sha256 && head.sha256 !== p.sha256)) {
      await this.db.photo.update({ where: { id: photoId }, data: { status: "FAILED", error: "Size or checksum doesn't match what was announced" } });
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "INTEGRITY_FAILED", "The stored file doesn't match its checksum");
    }
    await this.db.photo.updateMany({ where: { id: photoId, status: "PENDING" }, data: { status: "UPLOADED", uploadedAt: new Date() } });
    return { photoId, status: "UPLOADED" };
  }

  // ---------- processing (the database is the queue: restart-safe, no extra service) ----------

  onModuleInit() {
    if (!this.storage.enabled) return;
    this.timers.push(setInterval(() => void this.work(), WORK_MS));
    this.timers.push(setInterval(() => void this.applyRetention(), 3600_000));
    for (const t of this.timers) t.unref();
  }
  onModuleDestroy() { this.timers.forEach(clearInterval); }

  async work() {
    if (this.working) return;
    this.working = true;
    try {
      // A restart mid-processing leaves photos in PROCESSING: put them back in line.
      await this.db.photo.updateMany({ where: { status: "PROCESSING", uploadedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: "UPLOADED" } });
      for (;;) {
        const next = await this.db.photo.findFirst({ where: { status: "UPLOADED" }, orderBy: { uploadedAt: "asc" } });
        if (!next) break;
        const claimed = await this.db.photo.updateMany({ where: { id: next.id, status: "UPLOADED" }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
        if (claimed.count) await this.process(next.id);
      }
    } catch (e) {
      this.log.warn(`processing loop: ${(e as Error).message}`);
    } finally {
      this.working = false;
    }
  }

  private async process(id: string) {
    const p = await this.db.photo.findUniqueOrThrow({ where: { id } });
    try {
      const buf = await this.storage.get(p.key);
      // Integrity end to end, independent of what the bucket checked.
      if (createHash("sha256").update(buf).digest("hex") !== p.sha256) throw new Fatal("Checksum mismatch: the stored file is not the one announced");
      // Never trust the filename or the browser's type: read the bytes.
      const meta = await sharp(buf).metadata().catch(() => { throw new Fatal("Not a readable image"); });
      if (meta.format !== "jpeg") throw new Fatal(`Expected a JPEG, got ${meta.format ?? "unknown"}`);
      if (!meta.width || !meta.height || meta.width > MAX_PIXELS || meta.height > MAX_PIXELS) throw new Fatal("Image dimensions out of range");
      const thumbKey = p.key.replace(/\.jpg$/, "-thumb.jpg");
      const previewKey = p.key.replace(/\.jpg$/, "-preview.jpg");
      const base = sharp(buf).rotate(); // honour camera orientation
      await this.storage.put(thumbKey, await base.clone().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer(), "image/jpeg");
      await this.storage.put(previewKey, await base.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer(), "image/jpeg");
      await this.db.photo.update({ where: { id }, data: { status: "PROCESSED", width: meta.width, height: meta.height, thumbKey, previewKey, processedAt: new Date(), error: null } });
    } catch (e) {
      const fatal = e instanceof Fatal || p.attempts + 1 >= MAX_ATTEMPTS;
      await this.db.photo.update({ where: { id }, data: { status: fatal ? "FAILED" : "UPLOADED", error: (e as Error).message } });
      this.log.warn(`photo ${id}: ${(e as Error).message}${fatal ? "" : " (will retry)"}`);
    }
  }

  // ---------- admin ----------

  async eventPhotos(eventId: string, page = 1, pageSize = 48) {
    const event = await this.db.event.findUnique({ where: { id: eventId }, include: { config: true } });
    if (!event) throw notFound("Event");
    const [sessions, total, counts, eventGallery] = await Promise.all([
      this.db.session.findMany({
        where: { eventId, photos: { some: { status: { not: "DELETED" } } } },
        orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        include: { photos: { where: { status: { not: "DELETED" } }, orderBy: [{ kind: "desc" }, { index: "asc" }] }, gallery: true, booth: { select: { name: true, code: true } } },
      }),
      this.db.session.count({ where: { eventId, photos: { some: { status: { not: "DELETED" } } } } }),
      this.db.photo.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
      this.db.gallery.findFirst({ where: { eventId, scope: "EVENT", enabled: true } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    return {
      storageEnabled: this.storage.enabled,
      galleryEnabled: event.config?.galleryEnabled ?? true,
      saveOriginals: event.config?.saveOriginals ?? false,
      retentionDays: event.config?.galleryRetentionDays ?? 30,
      eventGalleryToken: eventGallery?.token ?? null,
      counts: byStatus,
      page, pageSize, total,
      sessions: await Promise.all(sessions.map(async (s) => ({
        id: s.id, startedAt: s.startedAt, status: s.status, booth: s.booth, galleryToken: s.gallery?.token ?? null,
        photos: await Promise.all(s.photos.map(async (p) => ({
          id: p.id, kind: p.kind, index: p.index, status: p.status, error: p.error, width: p.width, height: p.height,
          thumbUrl: p.thumbKey && this.storage.enabled ? await this.storage.presignGet(p.thumbKey) : null,
          // full size, saved as a file (not opened in the browser), with a readable name
          downloadUrl: p.status === "PROCESSED" && this.storage.enabled
            ? await this.storage.presignGet(p.key, `${slugify(event.name)}-${s.startedAt.toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${p.kind === "DESIGN" ? "design" : `photo-${p.index}`}.jpg`)
            : null,
        }))),
      }))),
    };
  }

  async getPhoto(id: string) {
    const p = await this.db.photo.findUnique({ where: { id } });
    if (!p || p.status === "DELETED") throw notFound("Photo");
    return { ...p, viewUrl: p.status === "PROCESSED" ? await this.storage.presignGet(p.previewKey ?? p.key) : null, downloadUrl: p.status === "PROCESSED" ? await this.storage.presignGet(p.key, `${p.id}.jpg`) : null };
  }

  /** Removes the files from the bucket and marks the rows DELETED (kept for counts and the audit trail). */
  async deletePhotos(where: { id?: string; eventId?: string; sessionId?: string }, actor: string, reason: string) {
    const photos = await this.db.photo.findMany({ where: { ...where, status: { not: "DELETED" } } });
    if (!photos.length) return { deleted: 0 };
    if (this.storage.enabled) await this.storage.delete(photos.flatMap((p) => [p.key, p.thumbKey, p.previewKey].filter((k): k is string => !!k)));
    await this.db.photo.updateMany({ where: { id: { in: photos.map((p) => p.id) } }, data: { status: "DELETED", thumbKey: null, previewKey: null } });
    await this.audit.record({ actor, action: "photos.delete", entityType: where.eventId ? "event" : "photo", entityId: where.eventId ?? where.id ?? where.sessionId, metadata: { count: photos.length, reason } });
    return { deleted: photos.length };
  }

  /** Photos older than the event's retention period are deleted, and its galleries closed. */
  async applyRetention(now = new Date()) {
    try {
      const events = await this.db.event.findMany({ where: { photos: { some: { status: { not: "DELETED" } } } }, include: { config: true } });
      for (const e of events) {
        const days = e.config?.galleryRetentionDays ?? 30;
        if (e.kind === "SELF_SERVICE") {
          // runs indefinitely: each photo is kept `days` from when it was taken; galleries stay open
          const cutoff = new Date(now.getTime() - days * 86400_000);
          const old = await this.db.photo.findMany({ where: { eventId: e.id, status: { not: "DELETED" }, createdAt: { lt: cutoff } }, select: { id: true } });
          for (const p of old) await this.deletePhotos({ id: p.id }, "system", `retention ${days} days`);
          if (old.length) this.log.log(`retention: deleted ${old.length} photos of "${e.name}"`);
          continue;
        }
        if (e.endsAt.getTime() + days * 86400_000 < now.getTime()) {
          const r = await this.deletePhotos({ eventId: e.id }, "system", `retention ${days} days`);
          await this.db.gallery.updateMany({ where: { eventId: e.id }, data: { enabled: false } });
          if (r.deleted) this.log.log(`retention: deleted ${r.deleted} photos of "${e.name}"`);
        }
      }
    } catch (err) {
      this.log.warn(`retention: ${(err as Error).message}`);
    }
  }

  async eventGallery(eventId: string, rotate: boolean, actor: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw notFound("Event");
    const current = await this.db.gallery.findFirst({ where: { eventId, scope: "EVENT", enabled: true } });
    if (current && !rotate) return { token: current.token };
    if (current) await this.db.gallery.update({ where: { id: current.id }, data: { enabled: false } });
    const g = await this.db.gallery.create({ data: { eventId, scope: "EVENT", token: newGalleryToken() } });
    await this.audit.record({ actor, action: rotate ? "gallery.rotate" : "gallery.create", entityType: "event", entityId: eventId });
    return { token: g.token };
  }

  /** Streams a ZIP of the event's designs or originals straight from the bucket. */
  async exportZip(eventId: string, kind: PhotoKind, out: Writable) {
    this.requireStorage();
    const event = await this.db.event.findUnique({ where: { id: eventId }, select: { name: true } });
    if (!event) throw notFound("Event");
    const photos = await this.db.photo.findMany({ where: { eventId, kind, status: "PROCESSED" }, orderBy: [{ createdAt: "asc" }, { index: "asc" }] });
    return this.zip(photos, out);
  }

  /** Streams these photos as a ZIP. A photo that's missing from the bucket is skipped, not the whole download. */
  async zip(photos: { id: string; key: string; kind: PhotoKind; index: number }[], out: Writable) {
    this.requireStorage();
    const zip = new ZipArchive({ store: true }); // JPEGs are already compressed
    zip.pipe(out);
    let n = 0;
    for (const p of photos) {
      n++;
      if (out.destroyed) break; // the download was cancelled
      const file = await this.storage.stream(p.key).catch((e: Error) => { this.log.warn(`zip: ${p.key}: ${e.message}`); return null; });
      if (!file) continue;
      // one file at a time: a big event must not hold hundreds of open downloads from the bucket
      await new Promise<void>((resolve, reject) => {
        const done = (e?: Error) => { out.off("close", closed); zip.off("entry", entry); zip.off("error", done); file.off("error", done); if (e) reject(e); else resolve(); };
        const closed = () => { file.destroy(); done(); }, entry = () => done();
        out.once("close", closed); zip.once("entry", entry); zip.once("error", done); file.once("error", done);
        zip.append(file, { name: `${String(n).padStart(4, "0")}-${p.kind === "DESIGN" ? "design" : `shot${p.index}`}-${p.id.slice(0, 8)}.jpg` });
      });
    }
    if (out.destroyed) { zip.abort(); return n; }
    await zip.finalize();
    return n;
  }
}

class Fatal extends Error {}

const slugify = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pbooth";
