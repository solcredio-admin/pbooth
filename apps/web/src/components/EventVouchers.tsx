"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { useMe } from "@/lib/roles";
import type { EventDto } from "@/lib/types";

interface VoucherRow {
  id: string; kind: "ONE_TIME" | "UNLIMITED"; hint: string; label: string | null; batch: string | null; uses: number;
  expiresAt: string | null; voidedAt: string | null; createdAt: string; createdBy: { username: string } | null;
}
interface NewCodes { kind: VoucherRow["kind"]; batch: string | null; label: string | null; expiresAt: string | null; codes: string[] }

export const peso = (centavos: number, currency = "PHP") =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: centavos % 100 ? 2 : 0 }).format(centavos / 100);

const status = (v: VoucherRow) =>
  v.voidedAt ? "Void" : v.expiresAt && new Date(v.expiresAt) <= new Date() ? "Expired" : v.kind === "ONE_TIME" && v.uses > 0 ? "Used" : "Active";

// Vouchers of one self-service event: make one-time codes (sold at the counter) or, for the owner,
// unlimited free-session codes; codes are shown once to print; void lost ones.
export function EventVouchers({ event }: { event: EventDto }) {
  const me = useMe();
  const [items, setItems] = useState<VoucherRow[] | null>(null);
  const [made, setMade] = useState<NewCodes | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await send<{ items: VoucherRow[] }>("GET", `/events/${event.id}/vouchers`);
    if (r.ok) setItems(r.data.items); else setError(r.message);
  }, [event.id]);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kind = String(f.get("kind")) as VoucherRow["kind"];
    const expires = String(f.get("expires") ?? "");
    setBusy(true); setError("");
    const r = await send<NewCodes>("POST", `/events/${event.id}/vouchers`, {
      kind, count: Number(f.get("count")) || 1, label: String(f.get("label") ?? ""),
      expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setMade(r.data);
    void load();
  };

  const voidOne = async (v: VoucherRow) => {
    if (!confirm(`Void voucher ••••-${v.hint}? It stops working at the booth. This can't be undone.`)) return;
    const r = await send("POST", `/events/${event.id}/vouchers/${v.id}/void`);
    if (!r.ok) setError(r.message); else void load();
  };

  const active = items?.filter((v) => status(v) === "Active").length ?? 0;
  return (
    <div className="vouchers">
      <section className="host" aria-labelledby="v-make">
        <div className="host-head"><span className="cap">{peso(event.priceCentavos, event.currency)} per paid session · codes work only at this event</span><h2 id="v-make">Make vouchers</h2></div>
        <form className="inline-form add-user" onSubmit={create}>
          <label className="field narrow-field"><span>Type</span>
            <select name="kind" defaultValue="ONE_TIME">
              <option value="ONE_TIME">One-time (sold at the counter)</option>
              {me.role === "OWNER" && <option value="UNLIMITED">Unlimited (owner, free sessions)</option>}
            </select>
            <span className="hint">One-time codes work once</span>
          </label>
          <label className="field narrow-field"><span>How many</span>
            <input name="count" type="number" min={1} max={200} defaultValue={20} />
            <span className="hint">Up to 200 at a time</span>
          </label>
          <label className="field"><span>Label</span>
            <input name="label" maxLength={60} placeholder="e.g. December batch" />
            <span className="hint">Optional</span>
          </label>
          <label className="field narrow-field"><span>Expires</span>
            <input name="expires" type="date" />
            <span className="hint">Optional</span>
          </label>
          <button className="btn" type="submit" disabled={busy}>{busy ? "Making…" : "Make codes"}</button>
        </form>
        {error && <p className="cap err" role="alert">{error}</p>}
      </section>

      {made && <NewCodesCard event={event} made={made} onClose={() => setMade(null)} />}

      <section className="host" aria-labelledby="v-list">
        <div className="host-head"><span className="cap">{items ? `${active} active · ${items.length} in total` : "Loading…"}</span><h2 id="v-list">All vouchers</h2></div>
        {items && items.length === 0 ? <p className="cap">No vouchers yet.</p> : items && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Type</th><th>Status</th><th className="hide-sm">Label</th><th className="hide-sm">Made</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} className={status(v) === "Active" ? undefined : "muted"}>
                    <td><code>••••-{v.hint}</code></td>
                    <td>{v.kind === "ONE_TIME" ? "One-time" : `Unlimited · ${v.uses} use${v.uses === 1 ? "" : "s"}`}</td>
                    <td><span className={"pill " + (status(v) === "Active" ? "s-ACTIVE" : status(v) === "Used" ? "s-COMPLETED" : "s-ARCHIVED")}>{status(v)}</span></td>
                    <td className="hide-sm">{v.label ?? "—"}{v.batch && <span className="cap"> · batch {v.batch}</span>}</td>
                    <td className="hide-sm cap">{new Date(v.createdAt).toLocaleDateString()}{v.createdBy ? ` · ${v.createdBy.username}` : ""}</td>
                    <td className="actions-cell">{status(v) === "Active" && <button type="button" className="row-btn danger" onClick={() => voidOne(v)}>Void</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// The codes just made, shown once: copy them, or print a sheet of cards for the counter.
function NewCodesCard({ event, made, onClose }: { event: EventDto; made: NewCodes; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const print = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w || !sheet.current) return;
    w.document.write(`<!doctype html><title>Vouchers · ${event.name}</title><style>
      body{font:14px ui-monospace,Menlo,monospace;margin:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .card{border:1px dashed #999;border-radius:8px;padding:12px;text-align:center;break-inside:avoid}
      .code{font-size:20px;font-weight:700;letter-spacing:.1em;margin:6px 0}.small{font-size:11px;color:#555}</style>${sheet.current.innerHTML}`);
    w.document.close(); w.focus(); w.print();
  };
  return (
    <section className="host new-codes" aria-labelledby="v-new">
      <div className="host-head"><span className="cap">Shown only now: print or copy them before you leave this page</span><h2 id="v-new">{made.codes.length} new {made.kind === "UNLIMITED" ? "unlimited code" : made.codes.length === 1 ? "code" : "codes"}</h2></div>
      <div className="codes-grid">{made.codes.map((c) => <code key={c}>{c}</code>)}</div>
      <div className="actions start">
        <button className="btn" type="button" onClick={print}>Print cards</button>
        <button className="btn ghost" type="button" onClick={async () => { await navigator.clipboard.writeText(made.codes.join("\n")); setCopied(true); }}>{copied ? "Copied" : "Copy all"}</button>
        <button className="plain" type="button" onClick={onClose}>Done</button>
      </div>
      <div ref={sheet} hidden>
        <div className="grid">
          {made.codes.map((c) => (
            <div className="card" key={c}>
              <div className="small">{event.name}</div>
              <div className="code">{c}</div>
              <div className="small">{made.kind === "UNLIMITED" ? "Free sessions" : `One photobooth session · ${peso(event.priceCentavos, event.currency)} value`}{made.expiresAt ? ` · until ${new Date(made.expiresAt).toLocaleDateString()}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
