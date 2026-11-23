import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CONFIG, type Config } from "../config.js";
import { StorageService } from "../storage/storage.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/errors.js";
import { dumpDatabase } from "./pg.js";

export const BACKUP_PREFIX = "backups/";
const KEEP = 30; // newest dumps kept in the bucket
const DAY_MS = 24 * 3600_000;

/** Daily database backups into the photo bucket (under backups/), plus "back up now". */
@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Backups");
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<unknown> | null = null;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly storage: StorageService, private readonly audit: AuditService) {}

  onModuleInit() {
    // Checked hourly; a backup runs when the newest one is a day old (or there is none).
    if (this.storage.enabled && this.cfg.NODE_ENV === "production") this.timer = setInterval(() => void this.daily(), 3600_000);
  }
  onModuleDestroy() { clearInterval(this.timer); }

  async list() {
    if (!this.storage.enabled) return { enabled: false, items: [] };
    const items = await this.storage.list(BACKUP_PREFIX);
    return { enabled: true, items: await Promise.all(items.map(async (o) => ({ ...o, url: await this.storage.presignGet(o.key, o.key.slice(BACKUP_PREFIX.length)) }))) };
  }

  /** One backup at a time; a second click while one runs just waits for it. */
  run(actor: string) {
    this.running ??= this.backup(actor).finally(() => { this.running = null; });
    return this.running as Promise<{ key: string; size: number }>;
  }

  private async backup(actor: string) {
    if (!this.storage.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "STORAGE_NOT_CONFIGURED", "Backups go to the photo bucket, which isn't set up yet");
    const dump = await dumpDatabase(this.cfg.DATABASE_URL);
    const key = `${BACKUP_PREFIX}pbooth-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
    await this.storage.put(key, dump, "application/octet-stream");
    const old = (await this.storage.list(BACKUP_PREFIX)).slice(KEEP).map((o) => o.key);
    if (old.length) await this.storage.delete(old);
    await this.audit.record({ actor, action: "backup.create", entityType: "backup", entityId: key, metadata: { size: dump.length, pruned: old.length } });
    this.log.log(`backup ${key} (${dump.length} bytes)`);
    return { key, size: dump.length };
  }

  private async daily() {
    try {
      const newest = (await this.storage.list(BACKUP_PREFIX))[0];
      if (!newest || Date.now() - newest.at.getTime() > DAY_MS) await this.run("system");
    } catch (e) {
      this.log.error(`daily backup failed: ${(e as Error).message}`);
    }
  }
}
