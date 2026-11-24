import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, notFound } from "../common/errors.js";
import type { AuthedAdmin } from "../common/request.js";
import { CONFIG, type Config } from "../config.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { newEnrollmentCode, normalizeEnrollmentCode } from "../booths/codes.js";
import { hashToken } from "../auth/tokens.js";
import type { EventScope } from "../events/events.service.js";
import type { Prisma, RefundReason } from "../generated/prisma/client.js";
import { PaymongoService } from "./paymongo.service.js";
import { SelfServiceService } from "./selfservice.service.js";

const REASON: Record<RefundReason, string> = { NO_SESSION: "paid but no session started", NO_PRINT: "photos didn't print", OTHER: "something else", SESSION_FAILED: "paid, but the session made no photos" };
export type RefundAction = "PAYMONGO" | "MANUAL" | "VOUCHER" | "REJECT";
const include = { payment: { select: { reference: true, method: true, status: true, amountCentavos: true, currency: true, paidAt: true } }, event: { select: { name: true, timeZone: true } } } as const;

/**
 * Guests asking for help, paid sessions that failed, and what staff did about it. Only the owner moves
 * money (PayMongo or by hand); cashiers can hand out a replacement voucher for their own events.
 */
@Injectable()
export class RefundsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Refunds");
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly paymongo: PaymongoService, private readonly ss: SelfServiceService, private readonly alerts: AlertsService, @Inject(CONFIG) private readonly cfg: Config) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), this.cfg.ALERT_SWEEP_SECONDS * 2000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try { await this.ss.settleStale(); await this.flagFailed(); await this.pollPaymongo(); } catch (e) { this.log.warn(`sweep failed: ${(e as Error).message}`); } finally { this.busy = false; }
  }

  // ---------- at the booth ----------

  private async live(boothId: string) {
    const r = await this.db.eventBooth.findFirst({ where: { boothId, event: { status: "ACTIVE", kind: "SELF_SERVICE" } }, include: { event: true } });
    if (!r) throw new ApiError(HttpStatus.CONFLICT, "NOT_SELF_SERVICE", "Help is for self-service booths");
    return r.event;
  }

  /** This booth's payments of the last 30 minutes: time and amount only, for a guest who lost their reference. */
  async recent(boothId: string) {
    const e = await this.live(boothId);
    const items = await this.db.payment.findMany({
      where: { boothId, eventId: e.id, status: "PAID", amountCentavos: { gt: 0 }, paidAt: { gt: new Date(Date.now() - 30 * 60_000) } },
      orderBy: { paidAt: "desc" }, take: 6, select: { id: true, paidAt: true, amountCentavos: true, currency: true },
    });
    return { items };
  }

  async ask(boothId: string, body: { reason: "NO_SESSION" | "NO_PRINT" | "OTHER"; reference?: string; paymentId?: string }, ip?: string) {
    const e = await this.live(boothId);
    let p: { id: string; reference: string } | null = null;
    if (body.reference || body.paymentId) {
      const c = body.reference ? normalizeEnrollmentCode(body.reference) : "";
      p = await this.db.payment.findFirst({
        where: { eventId: e.id, status: "PAID", ...(body.reference ? { reference: `${c.slice(0, 4)}-${c.slice(4)}` } : { id: body.paymentId, boothId }) }, select: { id: true, reference: true },
      });
      if (!p) throw new ApiError(HttpStatus.NOT_FOUND, "UNKNOWN_REFERENCE", "That reference isn't a payment here");
    }
    await this.open(e, boothId, p?.id ?? null, body.reason, ip);
    return { reference: p?.reference ?? null };
  }

  /** Opens a request, or does nothing if that payment already has one open. Never opens a second one. */
  private async open(e: { id: string; name: string }, boothId: string | null, paymentId: string | null, reason: RefundReason, ip?: string) {
    try {
      const r = await this.db.refundRequest.create({ data: { eventId: e.id, boothId, paymentId, reason }, include });
      await this.audit.record({ actor: boothId && ip ? `booth:${boothId}` : "system", action: "refund.request", entityType: "refund", entityId: r.id, ip, metadata: { reason } });
      const booth = boothId ? await this.db.booth.findUnique({ where: { id: boothId }, select: { name: true } }) : null;
      const money = r.payment ? `${r.payment.currency} ${(r.payment.amountCentavos / 100).toFixed(2)} by ${r.payment.method === "QR" ? "QR" : "voucher"}, ref ${r.payment.reference}` : "no payment reference given";
      await this.alerts.notify(`refund:${r.id}`, "REFUND", `🆘 Help asked at ${booth?.name ?? "a booth"} (${e.name}): ${REASON[reason]}. ${money}.\n${this.cfg.APP_ORIGIN}/refunds`);
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }

  // ---------- by itself ----------

  /** Paid, but no photos ever came of it. Booths that are offline are left alone: their sessions may still arrive. */
  private async flagFailed() {
    const now = Date.now();
    const rows = await this.db.payment.findMany({
      where: { status: "PAID", amountCentavos: { gt: 0 }, paidAt: { lt: new Date(now - this.cfg.REFUND_FLAG_MINUTES * 60_000), gt: new Date(now - 86_400_000) }, refundRequests: { none: {} }, event: { status: { in: ["ACTIVE", "COMPLETED"] } } },
      include: { event: { select: { id: true, name: true } } }, take: 50, orderBy: { paidAt: "desc" },
    });
    for (const p of rows) {
      const s = p.sessionId ? await this.db.session.findUnique({ where: { id: p.sessionId }, select: { status: true, photoCount: true, _count: { select: { photos: true } } } }) : null;
      if (s && (s.status === "COMPLETED" || s.photoCount > 0 || s._count.photos > 0)) continue;
      const k = p.boothId ? await this.db.kiosk.findUnique({ where: { boothId: p.boothId }, select: { lastSeenAt: true } }) : null;
      if (k && (!k.lastSeenAt || now - k.lastSeenAt.getTime() > this.cfg.BOOTH_OFFLINE_AFTER_SECONDS * 1000)) continue;
      await this.open(p.event, p.boothId, p.id, "SESSION_FAILED");
    }
  }

  /** Refunds the guest hasn't claimed yet: done, or bounced back to open. */
  private async pollPaymongo() {
    const rows = await this.db.refundRequest.findMany({ where: { status: "PROCESSING", providerRef: { not: null } }, take: 20, orderBy: { createdAt: "asc" } });
    for (const r of rows) {
      const st = await this.paymongo.refundStatus(r.providerRef!).catch(() => null);
      if (!st) continue;
      if (st.status === "succeeded") await this.db.refundRequest.updateMany({ where: { id: r.id, status: "PROCESSING" }, data: { status: "REFUNDED" } });
      else if (st.status === "failed") {
        await this.reopen(r.id, r.paymentId, "The guest didn't claim the refund, or PayMongo couldn't send it");
        await this.alerts.notify(`refund-failed:${r.id}`, "REFUND", `🆘 A refund didn't go through and is open again.\n${this.cfg.APP_ORIGIN}/refunds`);
      } else if (st.link && st.link !== r.link) await this.db.refundRequest.update({ where: { id: r.id }, data: { link: st.link } });
    }
  }

  private async reopen(id: string, paymentId: string | null, note: string) {
    await this.db.$transaction([
      this.db.refundRequest.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "OPEN", note, providerRef: null, link: null } }),
      ...(paymentId ? [this.db.payment.updateMany({ where: { id: paymentId, status: "REFUNDED" }, data: { status: "PAID" } })] : []),
    ]);
  }

  // ---------- staff ----------

  private scoped(scope?: EventScope): Prisma.RefundRequestWhereInput { return scope?.cashierId ? { event: { cashiers: { some: { adminId: scope.cashierId } } } } : {}; }

  async list(q: { status: "open" | "done"; eventId?: string }, scope?: EventScope) {
    const rows = await this.db.refundRequest.findMany({
      where: { ...this.scoped(scope), ...(q.eventId ? { eventId: q.eventId } : {}), status: { in: q.status === "open" ? ["OPEN", "PROCESSING"] : ["REFUNDED", "REPLACED", "REJECTED"] } },
      include, orderBy: { createdAt: "desc" }, take: 200,
    });
    const booths = new Map((await this.db.booth.findMany({ where: { id: { in: rows.flatMap((r) => r.boothId ?? []) } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
    return { items: rows.map((r) => ({ ...r, booth: r.boothId ? booths.get(r.boothId) ?? "Deleted booth" : null })), openCount: await this.db.refundRequest.count({ where: { ...this.scoped(scope), status: { in: ["OPEN", "PROCESSING"] } } }) };
  }

  async resolve(id: string, body: { action: RefundAction; note?: string }, by: AuthedAdmin, scope?: EventScope, ip?: string) {
    const r = await this.db.refundRequest.findFirst({ where: { id, ...this.scoped(scope) }, include: { payment: true, event: true } });
    if (!r) throw notFound("Request");
    if ((body.action === "PAYMONGO" || body.action === "MANUAL") && by.role !== "OWNER") throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "Only the owner refunds money");
    const taken = () => new ApiError(HttpStatus.CONFLICT, "ALREADY_HANDLED", "Someone already handled this request");
    const done = { note: body.note || null, resolvedBy: by.username, resolvedAt: new Date() };
    const record = (extra: object = {}) => this.audit.record({ actor: `admin:${by.id}`, action: `refund.${body.action.toLowerCase()}`, entityType: "refund", entityId: id, ip, metadata: { paymentId: r.paymentId, amount: r.payment?.amountCentavos ?? null, ...extra } });

    if (body.action === "PAYMONGO") {
      const p = r.payment;
      if (!p || p.method !== "QR" || !p.providerRef) throw new ApiError(HttpStatus.CONFLICT, "NOT_QR", "Only QR payments are refunded through PayMongo");
      // Taking the request first means a double click, or two people, send one refund. A try that ended
      // without an answer stays PROCESSING with no refund id; trying again reuses the same key.
      await this.db.$transaction(async (tx) => {
        const { count } = await tx.refundRequest.updateMany({ where: { id, OR: [{ status: "OPEN" }, { status: "PROCESSING", providerRef: null, resolvedAt: { lt: new Date(Date.now() - 30_000) } }] }, data: { ...done, status: "PROCESSING" } });
        if (!count) throw taken();
        const paid = await tx.payment.updateMany({ where: { id: p.id, status: r.status === "OPEN" ? "PAID" : "REFUNDED" }, data: { status: "REFUNDED" } }); // can't start a session any more
        if (!paid.count) throw new ApiError(HttpStatus.CONFLICT, "NOT_PAID", "That payment isn't paid any more");
      });
      try {
        const st = await this.paymongo.refund(p.providerRef, p.amountCentavos, id);
        await this.db.refundRequest.update({ where: { id }, data: { providerRef: st.id, link: st.link, status: st.status === "succeeded" ? "REFUNDED" : "PROCESSING" } });
        await record({ refund: st.id });
        return { status: st.status === "succeeded" ? "REFUNDED" : "PROCESSING", link: st.link };
      } catch (e) {
        if (e instanceof ApiError && e.code !== "PAYMENT_PROVIDER_DOWN") await this.reopen(id, p.id, e.message); // refused: nothing was sent
        else await this.db.refundRequest.updateMany({ where: { id }, data: { note: "No answer from PayMongo. Try again in 30 seconds; it can't be sent twice." } });
        throw e;
      }
    }

    const status = body.action === "MANUAL" ? "REFUNDED" as const : body.action === "VOUCHER" ? "REPLACED" as const : "REJECTED" as const;
    const code = body.action === "VOUCHER" ? newEnrollmentCode() : null;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.refundRequest.updateMany({ where: { id, status: "OPEN" }, data: { ...done, status } });
      if (!count) throw taken();
      if (body.action === "MANUAL" && r.paymentId) {
        const paid = await tx.payment.updateMany({ where: { id: r.paymentId, status: "PAID" }, data: { status: "REFUNDED" } });
        if (!paid.count) throw new ApiError(HttpStatus.CONFLICT, "NOT_PAID", "That payment isn't paid any more");
      }
      if (code) await tx.voucher.create({ data: { eventId: r.eventId, kind: "ONE_TIME", complimentary: true, codeHash: hashToken(normalizeEnrollmentCode(code)), hint: code.slice(-4), label: `Replacement${r.payment ? ` for ${r.payment.reference}` : ""}`, createdById: by.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    });
    await record();
    return { status, code }; // the code is shown once
  }
}
