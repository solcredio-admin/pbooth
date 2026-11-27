import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { csv } from "../selfservice/csv.js";

export interface AuditEntry {
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string;
  // Never put passwords, tokens or cookies in here.
  metadata?: Prisma.InputJsonValue;
}

// Kept for good: money and accounts. Everything else goes after a year.
const KEEP_FOREVER = ["payment.", "refund.", "voucher.", "user.", "admin."];
const YEAR = 365 * 86_400_000;
// What the filters mean, by action prefix.
export const AUDIT_KINDS = {
  events: ["event.", "photos.", "gallery."], booths: ["booth.", "device.", "kiosk."], stations: ["station.", "print."],
  users: ["user.", "admin.", "auth.password"], money: ["payment.", "refund.", "voucher."], signins: ["auth.login", "auth.logout"],
  system: ["backup.", "alerts."],
} as const;
export type AuditKind = keyof typeof AUDIT_KINDS;
// Never stored as values, only as "changed".
const SECRET = /password|pin|token|secret|hash|code|logo|png/i;

/** Old -> new for the fields that really changed (nested objects such as an event's config included). */
export function changes(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ""): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    const old = before?.[k];
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) { Object.assign(out, changes((old ?? {}) as Record<string, unknown>, v as Record<string, unknown>, `${prefix}${k}.`)); continue; }
    const a = old instanceof Date ? old.toISOString() : old ?? null, b = v instanceof Date ? v.toISOString() : v ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[`${prefix}${k}`] = SECRET.test(k) ? ["(hidden)", "(changed)"] : [a, b];
  }
  return out;
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Audit");
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.prune(), 6 * 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async prune() {
    try {
      await this.db.auditLog.deleteMany({ where: { at: { lt: new Date(Date.now() - YEAR) }, NOT: KEEP_FOREVER.map((p) => ({ action: { startsWith: p } })) } });
    } catch (e) { this.log.warn(`prune failed: ${(e as Error).message}`); }
  }

  // An audit write failing must not break the action being audited; it's reported instead.
  async record(entry: AuditEntry) {
    try {
      const id = /^admin:(.+)$/.exec(entry.actor)?.[1];
      const a = id ? await this.db.admin.findUnique({ where: { id }, select: { username: true, role: true } }) : null;
      await this.db.auditLog.create({ data: { ...entry, actorName: a ? `${a.username} (${a.role})` : null } });
    } catch (e) {
      this.log.error(`audit write failed for ${entry.action}: ${(e as Error).message}`);
    }
  }

  // ---------- reading (owner, Settings -> Audit log) ----------

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.actor) and.push({ actor: q.actor });
    if (q.entity) and.push({ entityId: q.entity });
    if (q.kind) and.push({ OR: AUDIT_KINDS[q.kind].map((p) => ({ action: { startsWith: p } })) });
    if (q.from) and.push({ at: { gte: new Date(q.from) } });
    if (q.to) and.push({ at: { lt: new Date(new Date(q.to).getTime() + 86_400_000) } });
    // guests and machines (voucher tries, pairing, check-ins) are noisy: only when asked for
    if (!q.guests) and.push({ OR: [{ actor: { startsWith: "admin:" } }, { actor: { in: ["system", "cli"] } }, { action: { startsWith: "auth." } }] });
    return { AND: and };
  }

  async list(q: AuditQuery) {
    const where = this.where(q);
    const [rows, total, accounts] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (q.page - 1) * 100, take: 100 }),
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({ where: { actor: { startsWith: "admin:" } }, distinct: ["actor"], select: { actor: true, actorName: true }, orderBy: { at: "desc" }, take: 200 }),
    ]);
    return { items: await this.named(rows), total, page: q.page, pageSize: 100, accounts };
  }

  async csv(q: AuditQuery) {
    const rows = await this.named(await this.db.auditLog.findMany({ where: this.where(q), orderBy: { at: "desc" }, take: 20_000 }));
    return csv([["Time (UTC)", "Who", "Action", "Item", "IP", "Details"], ...rows.map((r) => [r.at.toISOString(), r.actorName ?? r.actor, r.action, r.entityName ?? r.entityId ?? "", r.ip ?? "", r.metadata ? JSON.stringify(r.metadata) : ""])]);
  }

  /** The name of what each entry was done to, where it still exists. */
  private async named<T extends { entityType: string | null; entityId: string | null }>(rows: T[]) {
    const ids = (t: string) => [...new Set(rows.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!))].filter((x) => /^[0-9a-f-]{36}$/.test(x));
    const [events, booths, stations, users] = await Promise.all([
      this.db.event.findMany({ where: { id: { in: ids("event") } }, select: { id: true, name: true } }),
      this.db.booth.findMany({ where: { id: { in: ids("booth") } }, select: { id: true, name: true } }),
      this.db.station.findMany({ where: { id: { in: ids("station") } }, select: { id: true, name: true } }),
      this.db.admin.findMany({ where: { id: { in: [...ids("user"), ...ids("admin")] } }, select: { id: true, username: true } }),
    ]);
    const names = new Map<string, string>([...events, ...booths, ...stations].map((x) => [x.id, x.name]));
    for (const u of users) names.set(u.id, u.username);
    return rows.map((r) => ({ ...r, entityName: (r.entityId && names.get(r.entityId)) || null }));
  }
}

export interface AuditQuery { page: number; actor?: string; kind?: AuditKind; entity?: string; from?: string; to?: string; guests?: boolean }
