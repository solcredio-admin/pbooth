import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, notFound } from "../common/errors.js";
import { CONFIG, type Config } from "../config.js";
import { utcToWallTime } from "../events/tz.js";
import { TelegramService } from "./telegram.service.js";
import { withinHours } from "./hours.js";

export const ALERT_KINDS = ["OFFLINE", "KIOSK", "REFUND", "PAYMENTS"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Telegram alerts for live self-service booths. Every problem is one open Alert row: it's sent once,
 * reminded at most once a day while it lasts, and followed by a message when it ends. Rows survive a restart,
 * so restarting the server doesn't send anything twice.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Alerts");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly bootedAt = Date.now();
  private readonly since = new Map<string, number>(); // when a camera/printer/screen problem was first seen

  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly telegram: TelegramService, @Inject(CONFIG) private readonly cfg: Config) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), this.cfg.ALERT_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async tick() {
    if (this.busy) return; // a slow Telegram must not pile up sweeps
    this.busy = true;
    try { await this.sweep(); await this.deliver(); } catch (e) { this.log.warn(`sweep failed: ${(e as Error).message}`); } finally { this.busy = false; }
  }

  /** Something that happened once (a refund request). Sent within one sweep. */
  async notify(key: string, kind: AlertKind, text: string) {
    await this.db.alert.create({ data: { key, kind, text, clearedAt: new Date() } });
  }

  // ---------- what's wrong right now ----------

  private async sweep() {
    const now = Date.now();
    const rows = await this.db.eventBooth.findMany({
      where: { event: { kind: "SELF_SERVICE", status: "ACTIVE" } },
      include: { event: { select: { id: true, name: true, timeZone: true, alertFrom: true, alertTo: true } }, booth: { select: { id: true, name: true, device: true, kiosk: true } } },
    });
    const problems = new Map<string, { kind: AlertKind; text: string }>();
    const quiet = new Set<string>(); // outside its hours: whatever is open just closes, without a message

    for (const { event: e, booth: b } of rows) {
      const name = `${b.name} (${e.name})`;
      if (!withinHours(utcToWallTime(new Date(now), e.timeZone).time, e.alertFrom, e.alertTo)) { quiet.add(b.id).add(e.id); continue; }
      const device = b.device?.lastHeartbeatAt?.getTime() ?? 0, kiosk = b.kiosk?.lastSeenAt?.getTime() ?? 0;
      const seen = Math.max(device, kiosk);
      if (!seen) continue; // never connected yet
      const limit = this.cfg.ALERT_OFFLINE_SECONDS * 1000;
      // silent for a day: the booth is parked (packed away, switched off), not broken; closes without a message
      if (now - seen > DAY) { quiet.add(b.id); continue; }
      if (now - seen > limit) {
        // just after a restart every booth looks silent; give them a chance to check in
        if (now - this.bootedAt > limit) problems.set(`offline:${b.id}`, { kind: "OFFLINE", text: `🔴 ${name} is offline. Last seen ${utcToWallTime(new Date(seen), e.timeZone).time}.` });
        continue;
      }
      const error = b.kiosk && now - kiosk > limit ? "the guest screen stopped responding" : b.device?.lastError ?? b.kiosk?.lastError;
      const key = `kiosk:${b.id}`;
      if (!error) { this.since.delete(key); continue; }
      const first = this.since.get(key) ?? now;
      this.since.set(key, first);
      if (now - first >= this.cfg.ALERT_PROBLEM_SECONDS * 1000) problems.set(key, { kind: "KIOSK", text: `🟠 ${name}: ${error}` });
    }

    // A print nobody has taken for 2 minutes, one stuck at a station, or one that failed.
    const ago = (m: number) => new Date(now - m * 60_000);
    const stuck = await this.db.printJob.findMany({
      where: { boothId: { in: rows.map((r) => r.boothId) }, OR: [
        // waiting in a line that moves is fine
        { status: "WAITING", createdAt: { lt: ago(2) }, booth: { stations: { none: { station: { enabled: true, ready: true, lastPollAt: { gt: new Date(now - 15_000) } } } } } }, { status: { in: ["CLAIMED", "PRINTING"] }, claimedAt: { lt: ago(12) } }, { status: "FAILED", createdAt: { gt: ago(60) } },
      ] },
      include: { booth: { select: { name: true } }, event: { select: { name: true } }, station: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 200,
    });
    for (const j of stuck) {
      const key = `print:${j.boothId}`;
      if (quiet.has(j.boothId!) || problems.has(key)) continue;
      const what = j.status === "WAITING" ? "a print is waiting and no station is ready" : j.status === "FAILED" ? `a print failed at ${j.station?.name ?? "its station"}${j.error ? `: ${j.error}` : ""}` : `a print is stuck at ${j.station?.name ?? "a station"}`;
      problems.set(key, { kind: "KIOSK", text: `🖨 ${j.booth?.name} (${j.event.name}): ${what}.\n${this.cfg.APP_ORIGIN}/stations` });
    }

    for (const e of new Map(rows.map((r) => [r.event.id, r.event])).values()) {
      if (quiet.has(e.id)) continue;
      const last = await this.db.payment.findMany({
        where: { eventId: e.id, method: "QR", status: { not: "PENDING" }, createdAt: { gt: new Date(now - HOUR) } }, orderBy: { createdAt: "desc" }, take: 3, select: { status: true },
      });
      if (last.length === 3 && last.every((p) => p.status === "FAILED" || p.status === "EXPIRED"))
        problems.set(`payments:${e.id}`, { kind: "PAYMENTS", text: `🟡 ${e.name}: the last 3 QR payments weren't completed. Check that Scan to pay works.` });
    }

    const open = await this.db.alert.findMany({ where: { clearedAt: null } });
    for (const a of open) {
      if (problems.has(a.key)) { problems.delete(a.key); continue; }
      await this.db.alert.update({ where: { id: a.id }, data: { clearedAt: new Date() } });
      if (a.sentAt && !quiet.has(a.key.split(":")[1])) await this.notify(`${a.key}:ok`, a.kind as AlertKind, `✅ Resolved: ${a.text.replace(/^\S+ /, "")}`);
    }
    for (const [key, p] of problems) await this.db.alert.create({ data: { key, ...p } });
  }

  // ---------- sending ----------

  private async deliver() {
    if (!this.telegram.enabled) return;
    const now = Date.now();
    const due = await this.db.alert.findMany({
      where: { OR: [{ sentAt: null, createdAt: { gt: new Date(now - HOUR) } }, { clearedAt: null, sentAt: { lt: new Date(now - DAY) } }] }, orderBy: { createdAt: "asc" }, take: 30,
    });
    if (!due.length) return;
    const chats = await this.db.alertChat.findMany();
    for (const a of due) {
      const to = chats.filter((c) => c.kinds.includes(a.kind));
      const ok = await Promise.all(to.map((c) => this.sendTo(c, a.sentAt ? `${a.text}\n(still happening, daily reminder)` : a.text)));
      if (ok.some(Boolean)) await this.db.alert.update({ where: { id: a.id }, data: { sentAt: new Date() } }); // nobody got it: next sweep tries again
    }
  }

  private async sendTo(c: { id: string; chatId: string; lastError: string | null }, text: string) {
    const error = await this.telegram.send(c.chatId, text).then(() => null, (e: Error) => e.message);
    if (error !== c.lastError) await this.db.alertChat.updateMany({ where: { id: c.id }, data: { lastError: error } });
    return !error;
  }

  // ---------- settings (owner) ----------

  async status() {
    const [chats, recent, bot] = await Promise.all([
      this.db.alertChat.findMany({ orderBy: { createdAt: "asc" } }),
      this.db.alert.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      this.telegram.enabled ? this.telegram.me().then((username) => ({ username, error: null }), (e: Error) => ({ username: null, error: e.message })) : null,
    ]);
    return { enabled: this.telegram.enabled, bot, chats, recent };
  }

  async findChats() {
    this.need();
    const known = new Set((await this.db.alertChat.findMany({ select: { chatId: true } })).map((c) => c.chatId));
    return { items: (await this.telegram.recentChats().catch((e: Error) => { throw new ApiError(HttpStatus.BAD_GATEWAY, "TELEGRAM", e.message); })).filter((c) => !known.has(c.chatId)) };
  }

  async addChat(body: { chatId: string; label: string }, actor: string, ip?: string) {
    const c = await this.db.alertChat.upsert({ where: { chatId: body.chatId }, create: { ...body, kinds: [...ALERT_KINDS] }, update: { label: body.label } });
    await this.audit.record({ actor, action: "alerts.chat.add", entityType: "alertChat", entityId: c.id, ip });
    return c;
  }

  async setKinds(id: string, kinds: string[]) {
    const { count } = await this.db.alertChat.updateMany({ where: { id }, data: { kinds } });
    if (!count) throw notFound("Chat");
    return { kinds };
  }

  async removeChat(id: string, actor: string, ip?: string) {
    const { count } = await this.db.alertChat.deleteMany({ where: { id } });
    if (!count) throw notFound("Chat");
    await this.audit.record({ actor, action: "alerts.chat.remove", entityType: "alertChat", entityId: id, ip });
    return { removed: true };
  }

  async test(id: string) {
    this.need();
    const c = await this.db.alertChat.findUnique({ where: { id } });
    if (!c) throw notFound("Chat");
    if (!(await this.sendTo(c, "pbooth test: alerts reach this chat."))) throw new ApiError(HttpStatus.BAD_GATEWAY, "TELEGRAM", (await this.db.alertChat.findUniqueOrThrow({ where: { id } })).lastError ?? "Telegram refused");
    return { sent: true };
  }

  private need() {
    if (!this.telegram.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "TELEGRAM_OFF", "Add TELEGRAM_BOT_TOKEN to the server's .env first");
  }
}
