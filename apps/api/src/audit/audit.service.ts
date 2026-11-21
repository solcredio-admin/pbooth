import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

export interface AuditEntry {
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string;
  // Never put passwords, tokens or cookies in here.
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger("Audit");
  constructor(private readonly db: PrismaService) {}

  // An audit write failing must not break the action being audited; it's reported instead.
  async record(entry: AuditEntry) {
    try {
      await this.db.auditLog.create({ data: entry });
    } catch (e) {
      this.log.error(`audit write failed for ${entry.action}: ${(e as Error).message}`);
    }
  }
}
