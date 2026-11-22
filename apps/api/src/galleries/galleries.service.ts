import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { notFound } from "../common/errors.js";

const PAGE = 60;

// Guests' view of a gallery link. Any problem (unknown, disabled, expired) is the same 404,
// so a link reveals nothing about why it doesn't work.
@Injectable()
export class GalleriesService {
  constructor(private readonly db: PrismaService, private readonly storage: StorageService) {}

  private async open(token: string) {
    const g = await this.db.gallery.findUnique({ where: { token }, include: { event: { include: { config: true } } } });
    const days = g?.event.config?.galleryRetentionDays ?? 30;
    const expiresAt = g ? new Date(g.event.endsAt.getTime() + days * 86400_000) : null;
    if (!g || !g.enabled || g.event.config?.galleryEnabled === false || !this.storage.enabled || expiresAt! < new Date()) throw notFound("Gallery");
    return { g, expiresAt: expiresAt!, days };
  }

  async meta(token: string) {
    const { g, expiresAt, days } = await this.open(token);
    await this.db.gallery.update({ where: { id: g.id }, data: { views: { increment: 1 } } });
    const where = g.scope === "SESSION" ? { sessionId: g.sessionId! } : { eventId: g.eventId, kind: "DESIGN" as const };
    const [ready, pending] = await Promise.all([
      this.db.photo.count({ where: { ...where, status: "PROCESSED" } }),
      this.db.photo.count({ where: { ...where, status: { in: ["PENDING", "UPLOADED", "PROCESSING"] } } }),
    ]);
    const c = g.event.config;
    return {
      scope: g.scope,
      event: {
        name: g.event.name,
        date: new Intl.DateTimeFormat("en-US", { timeZone: g.event.timeZone, month: "long", day: "numeric", year: "numeric" }).format(g.event.startsAt),
        primaryColor: c?.primaryColor ?? "#0b0c0a", accentColor: c?.accentColor ?? "#c6f36b",
      },
      expiresAt, retentionDays: days, ready, pending,
    };
  }

  async photos(token: string, page = 1) {
    const { g } = await this.open(token);
    const where = g.scope === "SESSION" ? { sessionId: g.sessionId!, status: "PROCESSED" as const } : { eventId: g.eventId, kind: "DESIGN" as const, status: "PROCESSED" as const };
    const rows = await this.db.photo.findMany({
      where, orderBy: g.scope === "SESSION" ? [{ kind: "desc" }, { index: "asc" }] : [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE, take: PAGE,
    });
    const slug = g.event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photos";
    return {
      page, pageSize: PAGE,
      items: await Promise.all(rows.map(async (p, i) => ({
        id: p.id, kind: p.kind, index: p.index, width: p.width, height: p.height,
        thumbUrl: await this.storage.presignGet(p.thumbKey ?? p.key),
        previewUrl: await this.storage.presignGet(p.previewKey ?? p.key),
        downloadUrl: await this.storage.presignGet(p.key, `${slug}-${p.kind === "DESIGN" ? "design" : `photo-${p.index}`}-${(page - 1) * PAGE + i + 1}.jpg`),
      }))),
    };
  }
}

export { notFound };
