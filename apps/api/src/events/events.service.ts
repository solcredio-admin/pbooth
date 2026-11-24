import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, notFound } from "../common/errors.js";
import { EventStatus, type Prisma } from "../generated/prisma/client.js";
import type { CreateEvent, ListEvents, UpdateEvent } from "./events.schemas.js";
import { allowedTransitions, TRANSITIONS, type Transition } from "./transitions.js";
import { eventWindow, utcToWallTime } from "./tz.js";
import { BoothsService } from "../booths/booths.service.js";
import { PhotosService } from "../photos/photos.service.js";

const withConfig = { config: true, cashiers: { select: { admin: { select: { id: true, username: true } } } } } as const;

/** A cashier sees only the events assigned to them; everyone else sees all. */
export type EventScope = { cashierId?: string };
const scoped = (s?: EventScope): Prisma.EventWhereInput => (s?.cashierId ? { cashiers: { some: { adminId: s.cashierId } } } : {});
type EventRow = Prisma.EventGetPayload<{ include: typeof withConfig }>;

// What the web app receives: exact instants plus the same times on the venue's clock.
export function toDto(e: EventRow) {
  const start = utcToWallTime(e.startsAt, e.timeZone);
  const end = utcToWallTime(e.endsAt, e.timeZone);
  const { eventId: _e, id: _i, createdAt: _c, updatedAt: _u, ...config } = e.config ?? ({} as NonNullable<EventRow["config"]>);
  return {
    id: e.id, name: e.name, organizerName: e.organizerName, contactPhone: e.contactPhone, contactEmail: e.contactEmail, venueName: e.venueName, venueAddress: e.venueAddress,
    status: e.status, timeZone: e.timeZone, startsAt: e.startsAt, endsAt: e.endsAt,
    kind: e.kind, priceCentavos: e.priceCentavos, currency: e.currency, freeSessions: e.freeSessions, acceptVouchers: e.acceptVouchers, acceptQr: e.acceptQr,
    partnerName: e.partnerName, partnerSharePercent: e.partnerSharePercent,
    cashiers: e.cashiers.map((c) => c.admin),
    local: { date: start.date, startTime: start.time, endTime: end.time },
    activatedAt: e.activatedAt, completedAt: e.completedAt, createdAt: e.createdAt, updatedAt: e.updatedAt,
    config: e.config ? config : null,
    actions: allowedTransitions(e.status),
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly booths: BoothsService, private readonly photos: PhotosService) {}

  async list(q: ListEvents, scope?: EventScope) {
    const where: Prisma.EventWhereInput = {
      ...scoped(scope),
      ...(q.status ? { status: q.status } : q.hideArchived ? { status: { not: "ARCHIVED" } } : {}),
      ...(q.q ? { OR: ["name", "organizerName", "venueName"].map((f) => ({ [f]: { contains: q.q, mode: "insensitive" } })) } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.event.findMany({ where, include: withConfig, orderBy: { startsAt: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.event.count({ where }),
    ]);
    return { items: items.map(toDto), page: q.page, pageSize: q.pageSize, total };
  }

  async summary(scope?: EventScope) {
    const groups = await this.db.event.groupBy({ by: ["status"], where: scoped(scope), _count: { _all: true } });
    const byStatus = Object.fromEntries(Object.values(EventStatus).map((s) => [s, 0])) as Record<EventStatus, number>;
    for (const g of groups) byStatus[g.status] = g._count._all;
    return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
  }

  async get(id: string, scope?: EventScope) {
    const e = await this.db.event.findFirst({ where: { id, ...scoped(scope) }, include: withConfig });
    if (!e) throw notFound("Event"); // a cashier's unassigned event looks like it doesn't exist
    return toDto(e);
  }

  async create(body: CreateEvent, actor: string, ip?: string) {
    const { date, startTime, endTime, timeZone, config, ...rest } = body;
    const e = await this.db.event.create({
      data: { ...rest, timeZone, ...eventWindow(date, startTime, endTime, timeZone), config: { create: config ?? {} } },
      include: withConfig,
    });
    await this.audit.record({ actor, action: "event.create", entityType: "event", entityId: e.id, ip });
    return toDto(e);
  }

  async update(id: string, body: UpdateEvent, actor: string, ip?: string) {
    const current = await this.db.event.findUnique({ where: { id } });
    if (!current) throw notFound("Event");
    if (current.status === EventStatus.ARCHIVED) {
      throw new ApiError(HttpStatus.CONFLICT, "EVENT_ARCHIVED", "Archived events can't be edited");
    }
    const { date, startTime, endTime, timeZone, config, ...rest } = body;
    const times = date && startTime && endTime && timeZone ? { timeZone, ...eventWindow(date, startTime, endTime, timeZone) } : {};
    const e = await this.db.event.update({
      where: { id },
      data: { ...rest, ...times, ...(config ? { config: { upsert: { create: config, update: config } } } : {}) },
      include: withConfig,
    });
    await this.audit.record({ actor, action: "event.update", entityType: "event", entityId: id, ip, metadata: { fields: Object.keys(body) } });
    if (e.status === EventStatus.ACTIVE) await this.booths.pushForEvent(id); // live guest settings changed
    return toDto(e);
  }

  async transition(id: string, t: Transition, actor: string, ip?: string) {
    const { from, to } = TRANSITIONS[t];
    if (t === "activate") {
      // A booth can only serve one live event at a time.
      const assigned = await this.db.eventBooth.findMany({ where: { eventId: id }, select: { boothId: true } });
      await this.booths.assertFree(assigned.map((a) => a.boothId), id);
    }
    const stamp = t === "activate" ? { activatedAt: new Date(), completedAt: null } : t === "complete" ? { completedAt: new Date() } : {};
    // Conditional update: only succeeds if the status is still one we may move from,
    // so two clicks (or two tabs) can't both apply.
    const { count } = await this.db.event.updateMany({ where: { id, status: { in: [...from] } }, data: { status: to, ...stamp } });
    if (count === 0) {
      const e = await this.db.event.findUnique({ where: { id }, select: { status: true } });
      if (!e) throw notFound("Event");
      throw new ApiError(HttpStatus.CONFLICT, "INVALID_TRANSITION", `Can't ${t} an event that is ${e.status.toLowerCase()}`);
    }
    await this.audit.record({ actor, action: `event.${t}`, entityType: "event", entityId: id, ip });
    await this.booths.pushForEvent(id); // their status and config just changed
    return this.get(id);
  }

  /**
   * Deletes a draft or scheduled event and everything under it: photo files in storage first (if
   * any), then the event row (config, sessions, photos, galleries and booth bookings cascade).
   * The caller must type the event's exact name.
   */
  async remove(id: string, confirmName: string, actor: string, ip?: string) {
    const e = await this.db.event.findUnique({ where: { id }, select: { name: true, status: true, booths: { select: { boothId: true } } } });
    if (!e) throw notFound("Event");
    if (confirmName.trim() !== e.name.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, "CONFIRM_MISMATCH", "Type the event's name exactly to delete it");
    // Only events that never ran (a wrong draft, a cancelled booking). Events that happened stay on
    // record; retention still removes their photos.
    if (e.status !== EventStatus.DRAFT && e.status !== EventStatus.SCHEDULED) {
      throw new ApiError(HttpStatus.CONFLICT, "EVENT_HAPPENED", "Only draft or scheduled events can be deleted. Events that have run are kept for your records");
    }
    // Files first: if storage fails, nothing is deleted and the admin can retry.
    const { deleted } = await this.photos.deletePhotos({ eventId: id }, actor, "event deleted");
    await this.db.event.delete({ where: { id } });
    await this.audit.record({ actor, action: "event.delete", entityType: "event", entityId: id, ip, metadata: { name: e.name, photos: deleted } });
    this.booths.push(e.booths.map((b) => b.boothId)); // their next/live event changed
    return { deleted: true };
  }

  /** Which cashier accounts manage this event (replaces the list). Only CASHIER users count. */
  async setCashiers(id: string, adminIds: string[], actor: string, ip?: string) {
    await this.get(id);
    const valid = await this.db.admin.findMany({ where: { id: { in: adminIds }, role: "CASHIER" }, select: { id: true } });
    await this.db.$transaction([
      this.db.eventCashier.deleteMany({ where: { eventId: id } }),
      this.db.eventCashier.createMany({ data: valid.map((a) => ({ eventId: id, adminId: a.id })) }),
    ]);
    await this.audit.record({ actor, action: "event.cashiers", entityType: "event", entityId: id, ip, metadata: { adminIds: valid.map((a) => a.id) } });
    return this.get(id);
  }
}
