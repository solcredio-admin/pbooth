import { HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma.service.js";
import { ApiError } from "../common/errors.js";
import { normalizeEnrollmentCode } from "../booths/codes.js";
import type { EventScope } from "../events/events.service.js";
import { utcToWallTime, wallTimeToUtc } from "../events/tz.js";
import type { Prisma } from "../generated/prisma/client.js";
import { csv } from "./csv.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const transactionsSchema = z.object({
  eventId: z.string().uuid().optional(), from: day.optional(), to: day.optional(), boothId: z.string().uuid().optional(),
  method: z.enum(["QR", "VOUCHER", "FREE"]).optional(), status: z.enum(["PAID", "REFUNDED", "EXPIRED", "FAILED", "PENDING", "ALL"]).optional(),
  q: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1), daily: z.enum(["1"]).optional(),
});
export type TransactionsQuery = z.infer<typeof transactionsSchema>;
const PAGE = 50;
const MAX_CSV = 20_000;
const HOME_TZ = "Asia/Manila"; // all locations together: days on this clock (one event alone uses its own)

@Injectable()
export class TransactionsService {
  constructor(private readonly db: PrismaService) {}

  private async where(q: TransactionsQuery, scope?: EventScope): Promise<Prisma.PaymentWhereInput> {
    const mine: Prisma.EventWhereInput = { kind: "SELF_SERVICE", ...(scope?.cashierId ? { cashiers: { some: { adminId: scope.cashierId } } } : {}) };
    const tz = q.eventId ? (await this.db.event.findFirst({ where: { id: q.eventId, ...mine }, select: { timeZone: true } }))?.timeZone ?? HOME_TZ : HOME_TZ;
    const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const code = q.q ? normalizeEnrollmentCode(q.q) : "";
    return {
      event: mine, ...(q.eventId ? { eventId: q.eventId } : {}), ...(q.boothId ? { boothId: q.boothId } : {}), ...(q.method ? { method: q.method } : {}),
      ...(q.status === "ALL" ? {} : { status: q.status ?? { in: ["PAID", "REFUNDED"] } }),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: wallTimeToUtc(q.from, "00:00", tz) } : {}), ...(q.to ? { lt: wallTimeToUtc(next(q.to), "00:00", tz) } : {}) } } : {}),
      ...(q.q ? { OR: [{ reference: { contains: code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code } }, { voucher: { hint: code } }, { providerRef: q.q }] } : {}),
    };
  }

  private rows(where: Prisma.PaymentWhereInput, skip: number, take: number) {
    return this.db.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { event: { select: { name: true, timeZone: true, partnerSharePercent: true } }, voucher: { select: { hint: true } } } });
  }
  private async booths() { return new Map((await this.db.booth.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name])); }

  async list(q: TransactionsQuery, scope?: EventScope) {
    const where = await this.where(q, scope);
    const [rows, total, sums, booths] = await Promise.all([
      this.rows(where, (q.page - 1) * PAGE, PAGE), this.db.payment.count({ where }),
      this.db.payment.groupBy({ by: ["eventId", "status"], where, _sum: { amountCentavos: true }, _count: { _all: true } }), this.booths(),
    ]);
    const percent = new Map((await this.db.event.findMany({ where: { id: { in: sums.map((s) => s.eventId) } }, select: { id: true, partnerSharePercent: true } })).map((e) => [e.id, e.partnerSharePercent ?? 0]));
    const sum = (f: (s: (typeof sums)[number]) => boolean) => sums.filter(f).reduce((a, s) => a + (s._sum.amountCentavos ?? 0), 0);
    const net = sum((s) => s.status === "PAID"), refunds = sum((s) => s.status === "REFUNDED");
    return {
      page: q.page, pageSize: PAGE, total,
      totals: {
        sessions: sums.filter((s) => s.status === "PAID").reduce((a, s) => a + s._count._all, 0), grossCentavos: net + refunds, refundsCentavos: refunds, netCentavos: net,
        partnerShareCentavos: sums.filter((s) => s.status === "PAID").reduce((a, s) => a + Math.round(((s._sum.amountCentavos ?? 0) * (percent.get(s.eventId) ?? 0)) / 100), 0),
      },
      booths: [...booths].map(([id, name]) => ({ id, name })),
      items: rows.map((p) => ({
        id: p.id, createdAt: p.createdAt, reference: p.reference, event: p.event.name, timeZone: p.event.timeZone, booth: p.boothId ? booths.get(p.boothId) ?? "Deleted booth" : null,
        method: p.method, status: p.status, amountCentavos: p.amountCentavos, currency: p.currency, voucherHint: p.voucher?.hint ?? null, providerRef: p.providerRef,
      })),
    };
  }

  async csv(q: TransactionsQuery, scope?: EventScope) {
    const where = await this.where(q, scope);
    if (await this.db.payment.count({ where }) > MAX_CSV) throw new ApiError(HttpStatus.BAD_REQUEST, "TOO_MANY", `More than ${MAX_CSV} rows; pick a shorter date range`);
    const [rows, booths] = await Promise.all([this.rows(where, 0, MAX_CSV), this.booths()]);
    const peso = (c: number) => Number((c / 100).toFixed(2));
    if (q.daily) {
      const days = new Map<string, { event: string; sessions: number; paid: number; refunds: number; share: number }>();
      for (const p of rows) {
        const k = `${utcToWallTime(p.createdAt, p.event.timeZone).date}|${p.eventId}`;
        const d = days.get(k) ?? { event: p.event.name, sessions: 0, paid: 0, refunds: 0, share: 0 };
        if (p.status === "PAID") { d.sessions++; d.paid += p.amountCentavos; d.share += (p.amountCentavos * (p.event.partnerSharePercent ?? 0)) / 100; }
        if (p.status === "REFUNDED") d.refunds += p.amountCentavos;
        days.set(k, d);
      }
      return csv([["Date", "Location", "Sessions", "Gross", "Refunds", "Net", "Venue share"], ...[...days].sort().map(([k, d]) => [k.split("|")[0], d.event, d.sessions, peso(d.paid + d.refunds), peso(d.refunds), peso(d.paid), peso(Math.round(d.share))])]);
    }
    return csv([["Date", "Time", "Reference", "Location", "Booth", "Method", "Status", "Amount", "Currency", "Refunded", "Venue share", "Voucher", "PayMongo id", "Session"], ...rows.map((p) => {
      const t = utcToWallTime(p.createdAt, p.event.timeZone);
      return [t.date, t.time, p.reference, p.event.name, p.boothId ? booths.get(p.boothId) ?? "Deleted booth" : "", p.method, p.status, peso(p.amountCentavos), p.currency, p.status === "REFUNDED" ? peso(p.amountCentavos) : 0,
        p.status === "PAID" ? peso(Math.round((p.amountCentavos * (p.event.partnerSharePercent ?? 0)) / 100)) : 0, p.voucher ? `…${p.voucher.hint}` : "", p.providerRef ?? "", p.sessionId ?? ""];
    })]);
  }
}
