"use client";
import { useState } from "react";
import { send } from "@/lib/client-api";

type Result = { ok: boolean; steps: { name: string; ok: boolean; detail: string }[] };

export function StorageCheck({ enabled, bucket }: { enabled: boolean; bucket: string | null }) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="storage-check">
      <dl className="kv">
        <dt>Status</dt><dd>{enabled ? `Connected to bucket ${bucket}` : "Not set up: photos aren't saved"}</dd>
      </dl>
      {enabled && (
        <div className="actions start">
          <button className="btn ghost" type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await send<Result>("POST", "/storage/check"); setBusy(false); setResult(r.ok ? r.data : { ok: false, steps: [{ name: "check", ok: false, detail: r.message }] }); }}>
            {busy ? "Checking…" : "Run storage check"}
          </button>
        </div>
      )}
      {result && (
        <ul className="check-steps">
          {result.steps.map((s) => <li key={s.name} className={s.ok ? "ok" : "bad"}><b>{s.ok ? "✓" : "✗"} {s.name}</b> <span className="cap">{s.detail}</span></li>)}
        </ul>
      )}
      {!enabled && <p className="cap">Add the R2 bucket settings to the server&apos;s .env (see the README, “Photo storage (R2)”), then restart.</p>}
    </div>
  );
}
