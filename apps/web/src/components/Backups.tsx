"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client-api";
import { bytes } from "@/lib/format";

export interface BackupList { enabled: boolean; items: { key: string; size: number; at: string; url: string }[] }

// Database backups: made daily by the server, or now with the button; restore is a server command.
export function Backups({ data }: { data: BackupList }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const now = async () => {
    setBusy(true); setMsg(null);
    const r = await send<{ key: string; size: number }>("POST", "/backups");
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `Saved (${bytes(r.data.size)})` } : { ok: false, text: r.message });
    if (r.ok) router.refresh();
  };
  if (!data.enabled) return <p className="cap">Backups are saved to the photo bucket. Set up storage above first.</p>;
  const last = data.items[0];
  return (
    <div className="backups">
      <dl className="kv">
        <dt>Last backup</dt><dd>{last ? new Date(last.at).toLocaleString() : "None yet"}</dd>
        <dt>Schedule</dt><dd>Daily, keeping the latest 30</dd>
        <dt>Restore</dt><dd>On the server: <code>backup:restore --key &lt;name&gt; --yes</code> (see the README)</dd>
      </dl>
      <div className="actions start">
        <button className="btn ghost" type="button" disabled={busy} onClick={now}>{busy ? "Backing up…" : "Back up now"}</button>
        {msg && <span className={"cap " + (msg.ok ? "" : "err")} role="status">{msg.text}</span>}
      </div>
      {data.items.length > 0 && (
        <ul className="backup-list">
          {data.items.slice(0, 10).map((b) => (
            <li key={b.key}>
              <span>{new Date(b.at).toLocaleString()}</span>
              <span className="cap">{bytes(b.size)}</span>
              <a className="plain cap" href={b.url} download>Download</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
