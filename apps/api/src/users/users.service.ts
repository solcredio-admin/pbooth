import { HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma.service.js";
import { AuditService, changes } from "../audit/audit.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ApiError, notFound } from "../common/errors.js";
import { hashPassword, passwordProblem } from "../auth/password.js";
import { ROLES, type Role } from "../auth/roles.js";
import type { AuthedAdmin } from "../common/request.js";

// Lower-case letters, digits and . _ - @ + (so an email address still works as a username).
export const usernameSchema = z.string().trim().toLowerCase().min(3, "At least 3 characters").max(64)
  .regex(/^[a-z0-9._@+-]+$/, "Letters, numbers and . _ - @ + only");
const roleSchema = z.enum(ROLES as [Role, ...Role[]]);
export const createUserSchema = z.object({ username: usernameSchema, password: z.string().max(256), role: roleSchema });
export const updateUserSchema = z.object({ role: roleSchema.optional(), disabled: z.boolean().optional(), password: z.string().max(256).optional() });

const select = { id: true, username: true, role: true, disabled: true, createdAt: true, updatedAt: true } as const;

/** People who can sign in. Only OWNER accounts reach this (the routes are OWNER-only). */
@Injectable()
export class UsersService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  async list() {
    const rows = await this.db.admin.findMany({ select: { ...select, sessions: { select: { lastUsedAt: true }, orderBy: { lastUsedAt: "desc" }, take: 1 } }, orderBy: [{ role: "asc" }, { username: "asc" }] });
    return { items: rows.map(({ sessions, ...u }) => ({ ...u, lastActiveAt: sessions[0]?.lastUsedAt ?? null })) };
  }

  async create(body: z.infer<typeof createUserSchema>, by: AuthedAdmin, ip?: string) {
    const problem = passwordProblem(body.password);
    if (problem) throw new ApiError(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", problem);
    if (await this.db.admin.findUnique({ where: { username: body.username } })) throw new ApiError(HttpStatus.CONFLICT, "USERNAME_TAKEN", "That username is taken");
    const user = await this.db.admin.create({ data: { username: body.username, role: body.role, passwordHash: await hashPassword(body.password) }, select });
    await this.audit.record({ actor: `admin:${by.id}`, action: "user.create", entityType: "user", entityId: user.id, ip, metadata: { username: user.username, role: user.role } });
    return user;
  }

  async update(id: string, body: z.infer<typeof updateUserSchema>, by: AuthedAdmin, ip?: string) {
    const user = await this.db.admin.findUnique({ where: { id } });
    if (!user) throw notFound("User");
    const self = id === by.id;
    if (self && (body.disabled || (body.role && body.role !== "OWNER"))) {
      throw new ApiError(HttpStatus.CONFLICT, "SELF_LOCKOUT", "You can't disable your own account or take away your own super admin role");
    }
    const losesOwner = user.role === "OWNER" && !user.disabled && (body.disabled || (body.role && body.role !== "OWNER"));
    if (losesOwner) await this.keepAnOwner(id);
    let passwordHash: string | undefined;
    if (body.password !== undefined) {
      const problem = passwordProblem(body.password);
      if (problem) throw new ApiError(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD", problem);
      passwordHash = await hashPassword(body.password);
    }
    // A new role, a new password or being disabled signs that person out everywhere (now, not later).
    const signOut = body.disabled || passwordHash || (body.role && body.role !== user.role);
    const [updated] = await this.db.$transaction([
      this.db.admin.update({ where: { id }, data: { role: body.role, disabled: body.disabled, passwordHash }, select }),
      ...(signOut ? [this.db.adminSession.deleteMany({ where: { adminId: id, ...(self ? { id: { not: by.sessionId } } : {}) } })] : []),
    ]);
    await this.audit.record({
      actor: `admin:${by.id}`, action: "user.update", entityType: "user", entityId: id, ip,
      metadata: { changes: changes(user as unknown as Record<string, unknown>, { role: body.role, disabled: body.disabled }), passwordReset: body.password !== undefined } as Prisma.InputJsonValue,
    });
    return updated;
  }

  async remove(id: string, by: AuthedAdmin, ip?: string) {
    if (id === by.id) throw new ApiError(HttpStatus.CONFLICT, "SELF_LOCKOUT", "You can't remove your own account");
    const user = await this.db.admin.findUnique({ where: { id } });
    if (!user) throw notFound("User");
    if (user.role === "OWNER" && !user.disabled) await this.keepAnOwner(id);
    await this.db.admin.delete({ where: { id } }); // sessions go with it
    await this.audit.record({ actor: `admin:${by.id}`, action: "user.delete", entityType: "user", entityId: id, ip, metadata: { username: user.username } });
    return { deleted: true };
  }

  /** There must always be another active OWNER, or nobody could manage the install. */
  private async keepAnOwner(exceptId: string) {
    const others = await this.db.admin.count({ where: { role: "OWNER", disabled: false, id: { not: exceptId } } });
    if (others === 0) throw new ApiError(HttpStatus.CONFLICT, "LAST_OWNER", "Keep at least one active super admin");
  }
}
