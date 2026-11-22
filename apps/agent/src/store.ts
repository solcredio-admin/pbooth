import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// The agent's durable memory (SQLite, built into Node): enrollment, and print jobs that must
// survive a restart. Photos/upload queue join in Phase 6.
export type JobStatus = "queued" | "submitting" | "submitted" | "printing" | "completed" | "failed" | "cancelled";
export interface PrintJob {
  id: string; created_at: string; updated_at: string; printer: string | null; copies: number; paper: string;
  orientation: string; file: string; status: JobStatus; provider_job_id: string | null; attempts: number;
  error: string | null; completed_at: string | null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dirOrMemory: string) {
    const file = dirOrMemory === ":memory:" ? ":memory:" : join(dirOrMemory, "agent.db");
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") { try { chmodSync(file, 0o600); } catch { /* Windows: protected by the folder's ACL */ } } // holds the device token
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, printer TEXT, copies INTEGER NOT NULL,
        paper TEXT NOT NULL, orientation TEXT NOT NULL, file TEXT NOT NULL, status TEXT NOT NULL, provider_job_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, error TEXT, completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS print_jobs_status ON print_jobs(status);
    `);
  }

  get(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }
  set(key: string, value: string) {
    this.db.prepare("INSERT INTO state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  job(id: string) {
    return this.db.prepare("SELECT * FROM print_jobs WHERE id = ?").get(id) as PrintJob | undefined;
  }
  jobsWith(...statuses: JobStatus[]) {
    return this.db.prepare(`SELECT * FROM print_jobs WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at`).all(...statuses) as unknown as PrintJob[];
  }
  /** Inserts unless a job with this id exists. Returns true if this call created it. */
  insertJob(j: Pick<PrintJob, "id" | "printer" | "copies" | "paper" | "orientation" | "file">) {
    const now = new Date().toISOString();
    const r = this.db.prepare(`INSERT OR IGNORE INTO print_jobs (id, created_at, updated_at, printer, copies, paper, orientation, file, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`).run(j.id, now, now, j.printer, j.copies, j.paper, j.orientation, j.file);
    return r.changes === 1;
  }
  updateJob(id: string, patch: Partial<Omit<PrintJob, "id" | "created_at">>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.db.prepare(`UPDATE print_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...(Object.values(patch) as (string | number | null)[]), new Date().toISOString(), id);
  }
  summary() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const q = (sql: string, ...a: string[]) => (this.db.prepare(sql).get(...a) as { n: number }).n;
    return {
      queued: q("SELECT COUNT(*) n FROM print_jobs WHERE status IN ('queued','submitting','submitted','printing')"),
      failed: q("SELECT COUNT(*) n FROM print_jobs WHERE status = 'failed'"),
      completedToday: q("SELECT COUNT(*) n FROM print_jobs WHERE status = 'completed' AND completed_at >= ?", today.toISOString()),
    };
  }
}
