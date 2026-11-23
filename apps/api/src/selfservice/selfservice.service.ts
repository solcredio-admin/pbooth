import { HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, notFound } from "../common/errors.js";
import { hashToken } from "../auth/tokens.js";
import { newEnrollmentCode, normalizeEnrollmentCode } from "../booths/codes.js";
import type { AuthedAdmin } from "../common/request.js";
import type { EventScope } from "../events/events.service.js";

export const createVouchersSchema = z.object({
  kind: z.enum(["ONE_TIME", "UNLIMITED"]),
  count: z.number().int().min(1).max(200).default(1), // one-time codes per batch
  label: z.string().trim().max(60).transform((v) => v || null).nullish(),
  expiresAt: z.string().datetime().nullish(),
});

const voucherSelect = {
  id: true, kind: true, hint: true, label: true, batch: true, uses: true, expiresAt: true, voidedAt: true, createdAt: true,
  createdBy: { select: { username: true } },
} as const;

/**
 * Self-service events: vouchers (made in the event's Vouchers tab, redeemed at its booth) and the
 * money they bring in. Vouchers only ever work on their own event.
 */
@Injectable()
export class SelfServiceService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  /** The event, if this user may manage its vouchers (cashiers: only their assigned events). */
  private async event(eventId: string, scope?: EventScope) {
    const e = await this.db.event.findFirst({
      where: { id: eventId, ...(scope?.cashierId ? { cashiers: { some: { adminId: scope.cashierId } } } : {}) },
    });
    if (!e) throw notFound("Event");
    if (e.kind !== "SELF_SERVICE") throw new ApiError(HttpStatus.CONFLICT, "NOT_SELF_SERVICE", "Vouchers are for self-service events");
    return e;
  }

  async listVouchers(eventId: string, scope?: EventScope) {
    await this.event(eventId, scope);
    const items = await this.db.voucher.findMany({ where: { eventId }, select: voucherSelect, orderBy: { createdAt: "desc" }, take: 500 });
    return { items };
  }

  /**
   * Makes codes and returns them in plain text exactly once (only hashes are stored). One-time
   * codes are sold at the cashier; unlimited codes are the owner's free sessions.
   */
  async createVouchers(eventId: string, body: z.infer<typeof createVouchersSchema>, by: AuthedAdmin, scope?: EventScope, ip?: string) {
    await this.event(eventId, scope);
    if (body.kind === "UNLIMITED" && by.role !== "OWNER") {
      throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "Only the owner makes unlimited (free session) codes");
    }
    const count = body.kind === "UNLIMITED" ? 1 : body.count;
    const batch = body.kind === "ONE_TIME" ? randomUUID().slice(0, 8) : null;
    const codes = new Set<string>();
    while (codes.size < count) codes.add(newEnrollmentCode());
    const rows = [...codes].map((code) => ({
      eventId, kind: body.kind, codeHash: hashToken(normalizeEnrollmentCode(code)), hint: code.slice(-4),
      label: body.label ?? (body.kind === "UNLIMITED" ? "Owner" : null), batch, createdById: by.id,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    }));
    await this.db.voucher.createMany({ data: rows });
    await this.audit.record({ actor: `admin:${by.id}`, action: "voucher.create", entityType: "event", entityId: eventId, ip, metadata: { kind: body.kind, count, batch } });
    return { kind: body.kind, batch, label: rows[0].label, expiresAt: body.expiresAt ?? null, codes: [...codes] };
  }

  async voidVoucher(eventId: string, voucherId: string, by: AuthedAdmin, scope?: EventScope, ip?: string) {
    await this.event(eventId, scope);
    const { count } = await this.db.voucher.updateMany({ where: { id: voucherId, eventId, voidedAt: null }, data: { voidedAt: new Date() } });
    if (!count) throw notFound("Voucher");
    await this.audit.record({ actor: `admin:${by.id}`, action: "voucher.void", entityType: "voucher", entityId: voucherId, ip });
    return { voided: true };
  }

  /** Paid, voucher and free sessions, revenue, and the venue's share. */
  async revenue(eventId: string, scope?: EventScope) {
    const e = await this.event(eventId, scope);
    const startOfDay = new Date(new Date().toLocaleString("en-US", { timeZone: e.timeZone }));
    startOfDay.setHours(0, 0, 0, 0);
    const sum = async (since?: Date) => {
      const rows = await this.db.payment.groupBy({
        by: ["method"], where: { eventId, status: "PAID", ...(since ? { paidAt: { gte: since } } : {}) },
        _count: { _all: true }, _sum: { amountCentavos: true },
      });
      const byMethod = Object.fromEntries(rows.map((r) => [r.method, { sessions: r._count._all, amountCentavos: r._sum.amountCentavos ?? 0 }]));
      const amountCentavos = rows.reduce((a, r) => a + (r._sum.amountCentavos ?? 0), 0);
      const sessions = rows.reduce((a, r) => a + r._count._all, 0);
      const complimentary = await this.db.payment.count({ where: { eventId, status: "PAID", amountCentavos: 0, ...(since ? { paidAt: { gte: since } } : {}) } });
      return { sessions, complimentary, amountCentavos, byMethod };
    };
    const [all, today, vouchersLeft] = await Promise.all([
      sum(), sum(startOfDay),
      this.db.voucher.count({ where: { eventId, kind: "ONE_TIME", uses: 0, voidedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    ]);
    const share = (c: number) => (e.partnerSharePercent ? Math.round((c * e.partnerSharePercent) / 100) : 0);
    return {
      currency: e.currency, priceCentavos: e.priceCentavos,
      all: { ...all, partnerShareCentavos: share(all.amountCentavos) },
      today: { ...today, partnerShareCentavos: share(today.amountCentavos) },
      partner: e.partnerName || e.partnerSharePercent ? { name: e.partnerName, percent: e.partnerSharePercent ?? 0 } : null,
      unusedOneTimeVouchers: vouchersLeft,
    };
  }

  /**
   * At the booth: a guest's voucher unlocks one session on this booth's live self-service event.
   * Returns a payment id the kiosk sends when the session starts. One-time codes can be used once
   * (checked atomically); unlimited codes are free and recorded with amount 0.
   */
  async redeem(boothId: string, code: string, ip?: string) {
    const live = await this.db.eventBooth.findFirst({ where: { boothId, event: { status: "ACTIVE" } }, include: { event: true } });
    if (!live) throw new ApiError(HttpStatus.CONFLICT, "NO_LIVE_EVENT", "This booth isn't serving a live event");
    const e = live.event;
    if (e.kind !== "SELF_SERVICE" || e.freeSessions) throw new ApiError(HttpStatus.CONFLICT, "NO_PAYMENT_NEEDED", "This booth doesn't need a voucher");
    const v = await this.db.voucher.findUnique({ where: { codeHash: hashToken(normalizeEnrollmentCode(code)) } });
    const bad = () => new ApiError(HttpStatus.BAD_REQUEST, "INVALID_VOUCHER", "That code isn't valid here, or it's already been used");
    if (!v || v.eventId !== e.id || v.voidedAt || (v.expiresAt && v.expiresAt <= new Date())) {
      await this.audit.record({ actor: `booth:${boothId}`, action: "voucher.redeem.failed", entityType: "event", entityId: e.id, ip });
      throw bad();
    }
    if (v.kind === "ONE_TIME") {
      const { count } = await this.db.voucher.updateMany({ where: { id: v.id, uses: 0, voidedAt: null }, data: { uses: 1 } });
      if (!count) throw bad(); // someone used it a moment ago
    } else {
      await this.db.voucher.update({ where: { id: v.id }, data: { uses: { increment: 1 } } });
    }
    const p = await this.db.payment.create({
      data: {
        eventId: e.id, boothId, method: "VOUCHER", status: "PAID", voucherId: v.id, currency: e.currency, paidAt: new Date(),
        amountCentavos: v.kind === "ONE_TIME" ? e.priceCentavos : 0, // one-time = sold at the counter; unlimited = complimentary
      },
    });
    await this.audit.record({ actor: `booth:${boothId}`, action: "voucher.redeem", entityType: "voucher", entityId: v.id, ip, metadata: { paymentId: p.id } });
    return { paymentId: p.id, complimentary: v.kind === "UNLIMITED" };
  }

  /**
   * When a session starts on a self-service event: paid events need a paid, unused payment for
   * this event; free-session events record a FREE entry so reports count them.
   */
  async claimForSession(eventId: string, boothId: string, sessionId: string, paymentId?: string) {
    const e = await this.db.event.findUniqueOrThrow({ where: { id: eventId } });
    if (e.kind !== "SELF_SERVICE") return;
    if (e.freeSessions) {
      await this.db.payment.create({ data: { eventId, boothId, sessionId, method: "FREE", status: "PAID", amountCentavos: 0, currency: e.currency, paidAt: new Date() } });
      return;
    }
    const required = () => new ApiError(HttpStatus.PAYMENT_REQUIRED, "PAYMENT_REQUIRED", "This session hasn't been paid for");
    if (!paymentId) throw required();
    const { count } = await this.db.payment.updateMany({ where: { id: paymentId, eventId, status: "PAID", sessionId: null }, data: { sessionId } });
    if (!count) throw required();
  }
}
