import Link from "next/link";
import { Ago } from "./Ago";
import type { ReactNode } from "react";
import { BOOTH_LABEL, bytes } from "@/lib/format";
import type { BoothDto, HwStatus, SessionStats } from "@/lib/types";

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const hw = (s?: HwStatus) => (s ? `${s.name ?? "Unnamed"} · ${s.status}` : "Not reported");

// One booth's live state at a glance. Used on the event live view.
export function BoothCard({ b, action, stats }: { b: BoothDto; action?: ReactNode; stats?: SessionStats }) {
  const t = b.device?.telemetry ?? {};
  const kioskCam = b.kiosk?.telemetry.camera;
  const kq = b.kiosk?.telemetry.queue;
  return (
    <article className={`booth-card s-${b.status}`}>
      <header>
        <div>
          <span className="cap">{b.code}{b.simulated && <span className="sim-badge">Simulated</span>}</span>
          <h3><Link href={`/booths/${b.id}`}>{b.name}</Link></h3>
        </div>
        <span className={`pill b-${b.status}`}>{BOOTH_LABEL[b.status]}</span>
      </header>
      {b.lastError && <p className="booth-error" role="alert">{b.lastError}</p>}
      <dl className="kv">
        <dt>Last seen</dt><dd><Ago iso={b.lastSeenAt} /></dd>
        {stats && <><dt>Guests</dt><dd>{n(stats.completed, "session")} · {n(stats.photos, "photo")}</dd></>}
        <dt>Kiosk</dt><dd>{!b.kiosk ? "Not paired" : b.kiosk.online ? "On screen" : <>Last seen <Ago iso={b.kiosk.lastSeenAt} /></>}</dd>
        <dt>Camera</dt><dd>{kioskCam && b.camera.provider === "webcam" ? `${kioskCam.name ?? "Webcam"} · ${kioskCam.status}${kioskCam.resolution ? ` · ${kioskCam.resolution}` : ""}` : hw(t.camera)}</dd>
        <dt>Printer</dt><dd>{b.printer.enabled ? hw(t.printer) : "Printing off"}</dd>
        <dt>Queue</dt><dd>{(t.pendingUploads ?? 0) + (kq?.pending ?? 0)} uploads · {t.pendingPrints ?? 0} prints waiting on the booth{(t.printJobs?.failed ?? 0) + (kq?.failed ?? 0) ? ` · ${(t.printJobs?.failed ?? 0) + (kq?.failed ?? 0)} failed` : ""}</dd>
        {kq && <><dt>Synced</dt><dd>{kq.lastSyncAt ? <Ago iso={kq.lastSyncAt} /> : "not yet"}</dd></>}
        <dt>Storage</dt><dd>{t.storage ? `${bytes(t.storage.freeBytes)} free` : "—"}</dd>
        <dt>Config</dt><dd>{!b.device ? (b.kiosk ? "Kiosk reads it live" : "No device") : b.configApplied ? "Up to date" : "Waiting for the booth to apply changes"}</dd>
      </dl>
      {action && <footer>{action}</footer>}
    </article>
  );
}
