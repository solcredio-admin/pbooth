import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CONFIG, type Config } from "../config.js";
import { ApiError } from "../common/errors.js";
import type { AuthedAdmin } from "../common/request.js";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "./password.js";
import { hashToken, newToken } from "./tokens.js";

const TOUCH_EVERY_MS = 5 * 60_000;
// Across all IPs: a distributed guesser can't hammer the single admin account either.
const ACCOUNT_FAILURE_LIMIT = 20;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    email = email.trim().toLowerCase();
    const since = new Date(Date.now() - this.cfg.LOGIN_WINDOW_MINUTES * 60_000);
    const recentFailures = await this.db.auditLog.count({
      where: { action: "auth.login.failed", at: { gte: since } },
    });
    if (recentFailures >= ACCOUNT_FAILURE_LIMIT) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many failed sign-ins. Try again later.");
    }

    const admin = await this.db.admin.findUnique({ where: { email } });
    const ok = await verifyPassword(admin?.passwordHash ?? (await dummyHash()), password);
    if (!admin || !ok) {
      await this.audit.record({ actor: "anonymous", action: "auth.login.failed", ip: meta.ip });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Wrong email or password");
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + this.cfg.SESSION_TTL_HOURS * 3_600_000);
    await this.db.adminSession.create({
      data: { adminId: admin.id, tokenHash: hashToken(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    // Housekeeping: drop this admin's expired sessions.
    await this.db.adminSession.deleteMany({ where: { adminId: admin.id, expiresAt: { lt: new Date() } } });
    await this.audit.record({ actor: `admin:${admin.id}`, action: "auth.login", ip: meta.ip });
    return { token, expiresAt, admin: { id: admin.id, email: admin.email } };
  }

  async resolve(token: string | undefined): Promise<AuthedAdmin | null> {
    if (!token) return null;
    const session = await this.db.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { admin: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    if (Date.now() - session.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.db.adminSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    return { id: session.admin.id, email: session.admin.email, sessionId: session.id };
  }

  async logout(admin: AuthedAdmin, ip?: string) {
    await this.db.adminSession.deleteMany({ where: { id: admin.sessionId } });
    await this.audit.record({ actor: `admin:${admin.id}`, action: "auth.logout", ip });
  }

  // Changing the password signs out every other browser.
  async changePassword(admin: AuthedAdmin, current: string, next: string, ip?: string) {
    const row = await this.db.admin.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await verifyPassword(row.passwordHash, current))) {
      await this.audit.record({ actor: `admin:${admin.id}`, action: "auth.password.failed", ip });
      throw new ApiError(HttpStatus.BAD_REQUEST, "INVALID_CREDENTIALS", "Current password is wrong");
    }
    const problem = passwordProblem(next);
    if (problem) throw new ApiError(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", problem);
    await this.db.$transaction([
      this.db.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next) } }),
      this.db.adminSession.deleteMany({ where: { adminId: admin.id, id: { not: admin.sessionId } } }),
    ]);
    await this.audit.record({ actor: `admin:${admin.id}`, action: "auth.password.changed", ip });
  }
}
