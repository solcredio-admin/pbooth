import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { ApiError, notFound } from "../common/errors.js";

export interface SessionStats { sessions: number; completed: number; photos: number }

@Injectable()
export class SessionsService {
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeGateway) {}

  /**
   * Idempotent: the kiosk makes the UUID, so sending the same start twice is harmless.
   * Offline booths send sessions late. If the kiosk says which event it was serving, the session is
   * accepted as long as this booth was booked for that event and it was live (ACTIVE) or has since
   * been completed, so photos shot during an outage still land even if the event ended meanwhile.
   */
  async start(boothId: string, id: string, startedAt?: string, galleryToken?: string, eventId?: string) {
    const live = eventId
      ? await this.db.eventBooth.findFirst({ where: { boothId, eventId, event: { status: { in: ["ACTIVE", "COMPLETED"] } } }, select: { eventId: true } })
      : await this.db.eventBooth.findFirst({ where: { boothId, event: { status: "ACTIVE" } }, select: { eventId: true } });
    const existing = await this.db.session.findUnique({ where: { id } });
    if (existing) {
      if (existing.boothId !== boothId) throw new ApiError(HttpStatus.CONFLICT, "SESSION_CONFLICT", "Session belongs to another booth");
      return { id, eventId: existing.eventId, status: existing.status };
    }
    if (!live) throw new ApiError(HttpStatus.CONFLICT, "NO_LIVE_EVENT", "This booth isn't serving a live event");
    // Trust the kiosk's clock (sessions may be sent late), but never a time in the future.
    const at = startedAt ? new Date(Math.min(new Date(startedAt).getTime(), Date.now())) : new Date();
    const s = await this.db.session.create({
      data: { id, boothId, eventId: live.eventId, startedAt: at, ...(galleryToken ? { gallery: { create: { token: galleryToken, scope: "SESSION", eventId: live.eventId } } } : {}) },
    });
    await this.emit(s.eventId, boothId);
    return { id, eventId: s.eventId, status: s.status };
  }

  /** Idempotent too: finishing an already-finished session just returns it. */
  async finish(boothId: string, id: string, body: { status: "COMPLETED" | "ABANDONED"; photoCount: number; retakeCount: number }) {
    const s = await this.db.session.findUnique({ where: { id } });
    if (!s || s.boothId !== boothId) throw notFound("Session");
    if (s.status === "STARTED") {
      await this.db.session.updateMany({
        where: { id, status: "STARTED" },
        data: { status: body.status, endedAt: new Date(), photoCount: body.photoCount, retakeCount: body.retakeCount },
      });
      await this.emit(s.eventId, boothId);
    }
    return this.db.session.findUniqueOrThrow({ where: { id } });
  }

  async get(id: string) {
    const s = await this.db.session.findUnique({ where: { id }, include: { booth: { select: { name: true, code: true } }, event: { select: { name: true } } } });
    if (!s) throw notFound("Session");
    return s;
  }

  /** Per-booth and total counts for one event. */
  async stats(eventId: string) {
    const rows = await this.db.session.groupBy({ by: ["boothId", "status"], where: { eventId }, _count: { _all: true }, _sum: { photoCount: true } });
    const byBooth: Record<string, SessionStats> = {};
    const total: SessionStats = { sessions: 0, completed: 0, photos: 0 };
    for (const r of rows) {
      const b = (byBooth[r.boothId] ??= { sessions: 0, completed: 0, photos: 0 });
      for (const t of [b, total]) {
        t.sessions += r._count._all;
        if (r.status === "COMPLETED") { t.completed += r._count._all; t.photos += r._sum.photoCount ?? 0; }
      }
    }
    return { byBooth, total };
  }

  private async emit(eventId: string, boothId: string) {
    this.realtime.sessionsChanged({ eventId, boothId, stats: await this.stats(eventId) });
  }
}
