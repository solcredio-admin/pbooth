import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, notFound } from "../common/errors.js";
import { EventStatus, type Prisma } from "../generated/prisma/client.js";
import type { CreateEvent, ListEvents, UpdateEvent } from "./events.schemas.js";
import { allowedTransitions, TRANSITIONS, type Transition } from "./transitions.js";
import { eventWindow, utcToWallTime } from "./tz.js";

const withConfig = { config: true } as const;
type EventRow = Prisma.EventGetPayload<{ include: typeof withConfig }>;

// What the web app receives: exact instants plus the same times on the venue's clock.
export function toDto(e: EventRow) {
  const start = utcToWallTime(e.startsAt, e.timeZone);
  const end = utcToWallTime(e.endsAt, e.timeZone);
  const { eventId: _e, id: _i, createdAt: _c, updatedAt: _u, ...config } = e.config ?? ({} as NonNullable<EventRow["config"]>);
  return {
    id: e.id, name: e.name, organizerName: e.organizerName, venueName: e.venueName, venueAddress: e.venueAddress,
    status: e.status, timeZone: e.timeZone, startsAt: e.startsAt, endsAt: e.endsAt,
    local: { date: start.date, startTime: start.time, endTime: end.time },
    activatedAt: e.activatedAt, completedAt: e.completedAt, createdAt: e.createdAt, updatedAt: e.updatedAt,
    config: e.config ? config : null,
    actions: allowedTransitions(e.status),
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  async list(q: ListEvents) {
    const where: Prisma.EventWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: ["name", "organizerName", "venueName"].map((f) => ({ [f]: { contains: q.q, mode: "insensitive" } })) } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.event.findMany({ where, include: withConfig, orderBy: { startsAt: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.event.count({ where }),
    ]);
    return { items: items.map(toDto), page: q.page, pageSize: q.pageSize, total };
  }

  async summary() {
    const groups = await this.db.event.groupBy({ by: ["status"], _count: { _all: true } });
    const byStatus = Object.fromEntries(Object.values(EventStatus).map((s) => [s, 0])) as Record<EventStatus, number>;
    for (const g of groups) byStatus[g.status] = g._count._all;
    return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
  }

  async get(id: string) {
    const e = await this.db.event.findUnique({ where: { id }, include: withConfig });
    if (!e) throw notFound("Event");
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
    return toDto(e);
  }

  async transition(id: string, t: Transition, actor: string, ip?: string) {
    const { from, to } = TRANSITIONS[t];
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
    return this.get(id);
  }
}
