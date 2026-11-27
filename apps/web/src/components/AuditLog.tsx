"use client";
import { useCallback, useEffect, useState } from "react";
import { send } from "@/lib/client-api";

interface Entry { id: string; at: string; actor: string; actorName: string | null; action: string; entityType: string | null; entityId: string | null; entityName: string | null; ip: string | null; metadata: { changes?: Record<string, [unknown, unknown]> } & Record<string, unknown> | null }
interface Page { items: Entry[]; total: number; page: number; pageSize: number; accounts: { actor: string; actorName: string | null }[] }

const KINDS = { events: "Events", booths: "Booths", stations: "Stations", users: "Users", money: "Money", signins: "Sign-ins", system: "System" } as const;
// "booth.kiosk-code" -> "booth: kiosk code"; the common ones read as sentences
const VERB: Record<string, string> = {
  create: "created", update: "edited", delete: "deleted", activate: "started", complete: "wrapped up", archive: "archived", schedule: "scheduled",
  login: "signed in", logout: "signed out", "login.failed": "failed to sign in", "password.changed": "changed their password", "password.failed": "entered a wrong password",
  revoke: "revoked", "sign-out": "signed out the computer of", enroll: "connected", "enrollment-code": "made a connection code for", "kiosk-code": "made a kiosk code for",
  "kiosk-unpair": "unpaired the kiosk of", stations: "changed the stations of", "booth.assign": "booked a booth on", "booth.unassign": "took a booth off", cashiers: "changed the cashiers of",
  "frame.upload": "uploaded a frame to", "frame.remove": "removed a frame from", retry: "printed again", move: "moved a print", reprint: "reprinted a photo",
};
function sentence(e: Entry) {
  const [thing, ...rest] = e.action.split(".");
  const verb = VERB[rest.join(".")] ?? rest.join(" ").replace(/[-_]/g, " ");
  const what = e.entityName ? `${e.entityType ?? thing} “${e.entityName}”` : thing === "auth" ? "" : thing;
  return thing === "auth" ? verb : `${verb} ${what}`.trim();
}
const who = (e: Entry) => e.actorName ?? (e.actor === "system" ? "pbooth itself" : e.actor === "cli" ? "server command" : e.actor.startsWith("admin:") ? "deleted account" : e.actor.replace(/:.*/, ""));
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Settings → Audit log: who changed what, when. Read-only. */
export function AuditLog({ initialEntity }: { initialEntity?: string }) {
  const [q, setQ] = useState({ actor: "", kind: "", from: "", to: "", entity: initialEntity ?? "", guests: false, page: 1 });
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const params = new URLSearchParams(Object.entries({ ...q, guests: q.guests ? "1" : "" }).filter(([, v]) => v !== "").map(([k, v]) => [k, String(v)]));
  const qs = params.toString();
  const load = useCallback(async () => {
    const r = await send<Page>("GET", `/audit?${qs}`);
    if (r.ok) { setData(r.data); setError(""); } else setError(r.message);
  }, [qs]);
  useEffect(() => { void load(); }, [load]);
  const set = (k: keyof typeof q, v: string | boolean) => setQ((o) => ({ ...o, [k]: v, page: k === "page" ? Number(v) : 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const time = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  return (
    <>
      <div className="filters audit-filters">
        <label className="field"><span>Account</span>
          <select value={q.actor} onChange={(e) => set("actor", e.target.value)}>
            <option value="">Everyone</option>
            {data?.accounts.map((a) => <option key={a.actor} value={a.actor}>{a.actorName ?? "deleted account"}</option>)}
          </select></label>
        <label className="field"><span>Kind</span>
          <select value={q.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="field"><span>From</span><input type="date" value={q.from} onChange={(e) => set("from", e.target.value)} /></label>
        <label className="field"><span>Until</span><input type="date" value={q.to} onChange={(e) => set("to", e.target.value)} /></label>
      </div>
      <div className="audit-bar">
        <label className="check"><input type="checkbox" checked={q.guests} onChange={(e) => set("guests", e.target.checked)} /><span>Also guests and booths (voucher tries, pairing)</span></label>
        {q.entity && <button type="button" className="row-btn" onClick={() => set("entity", "")}>Showing one item · show all</button>}
        <a className="plain" href={`/api/v1/audit/csv?${qs}`}>Download CSV</a>
      </div>
      {error && <p className="cap err" role="alert">{error}</p>}
      {data && (data.items.length === 0 ? <p className="cap center">Nothing matches.</p> : (
        <ul className="refunds audit">
          {data.items.map((e) => {
            const ch = e.metadata?.changes ? Object.entries(e.metadata.changes) : [];
            return (
              <li key={e.id}>
                <div>
                  <b>{who(e)}</b> {sentence(e)}
                  <div className="sub">{time(e.at)}{e.ip ? ` · ${e.ip}` : ""}</div>
                  {ch.length > 0 && <ul className="audit-changes">{ch.map(([k, [a, b]]) => <li key={k}><code>{k}</code> {show(a)} → {show(b)}</li>)}</ul>}
                </div>
              </li>
            );
          })}
        </ul>
      ))}
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn ghost" type="button" disabled={q.page <= 1} onClick={() => set("page", String(q.page - 1))}>Newer</button>
          <span className="cap">Page {q.page} of {pages} · {data?.total} entries</span>
          <button className="btn ghost" type="button" disabled={q.page >= pages} onClick={() => set("page", String(q.page + 1))}>Older</button>
        </nav>
      )}
      <p className="cap">Kept for a year; money and account changes are kept for good. Nobody can edit or delete entries here.</p>
    </>
  );
}
