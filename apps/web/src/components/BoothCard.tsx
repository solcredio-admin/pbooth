import Link from "next/link";
import { Ago } from "./Ago";
import type { ReactNode } from "react";
import { BOOTH_LABEL, bytes } from "@/lib/format";
import type { BoothDto, HwStatus } from "@/lib/types";

const hw = (s?: HwStatus) => (s ? `${s.name ?? "Unnamed"} · ${s.status}` : "Not reported");

// One booth's live state at a glance. Used on the event live view.
export function BoothCard({ b, action }: { b: BoothDto; action?: ReactNode }) {
  const t = b.device?.telemetry ?? {};
  return (
    <article className={`booth-card s-${b.status}`}>
      <header>
        <div>
          <span className="cap">{b.code}{b.simulated && <span className="sim-badge">Simulated</span>}</span>
          <h3><Link href={`/booths/${b.id}`}>{b.name}</Link></h3>
        </div>
        <span className={`pill b-${b.status}`}>{BOOTH_LABEL[b.status]}</span>
      </header>
      {b.device?.lastError && <p className="booth-error" role="alert">{b.device.lastError}</p>}
      <dl className="kv">
        <dt>Last seen</dt><dd><Ago iso={b.device?.lastHeartbeatAt} /></dd>
        <dt>Camera</dt><dd>{hw(t.camera)}</dd>
        <dt>Printer</dt><dd>{b.printer.enabled ? hw(t.printer) : "Printing off"}</dd>
        <dt>Queue</dt><dd>{t.pendingUploads ?? 0} uploads · {t.pendingPrints ?? 0} prints pending</dd>
        <dt>Storage</dt><dd>{t.storage ? `${bytes(t.storage.freeBytes)} free` : "—"}</dd>
        <dt>Config</dt><dd>{!b.device ? "No device" : b.configApplied ? "Up to date" : "Waiting for the booth to apply changes"}</dd>
      </dl>
      {action && <footer>{action}</footer>}
    </article>
  );
}
