"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client-api";
import { peso } from "@/lib/peso";
import type { EventDto } from "@/lib/types";
import type { UserRow } from "./UsersAdmin";

interface Totals { sessions: number; complimentary: number; amountCentavos: number; partnerShareCentavos: number; byMethod: Record<string, { sessions: number; amountCentavos: number }> }
export interface Revenue { currency: string; priceCentavos: number; all: Totals; today: Totals; partner: { name: string | null; percent: number } | null; unusedOneTimeVouchers: number; qrEnabled?: boolean }

// Sidebar: sessions and money for a self-service event, today and since it opened.
export function EventRevenue({ revenue: r, eventId }: { revenue: Revenue; eventId: string }) {
  const line = (t: Totals) => `${t.sessions} session${t.sessions === 1 ? "" : "s"}${t.complimentary ? ` (${t.complimentary} free)` : ""}`;
  return (
    <section className="side-card" aria-labelledby="side-sales">
      <h2 id="side-sales">Sales</h2>
      <dl className="kv">
        <dt>Today</dt><dd><b>{peso(r.today.amountCentavos, r.currency)}</b><br /><span className="cap">{line(r.today)}</span></dd>
        <dt>All time</dt><dd><b>{peso(r.all.amountCentavos, r.currency)}</b><br /><span className="cap">{line(r.all)}</span></dd>
        {r.partner && <><dt>{r.partner.name ?? "Venue"}</dt><dd>{r.partner.percent}% · {peso(r.all.partnerShareCentavos, r.currency)}<br /><span className="cap">today {peso(r.today.partnerShareCentavos, r.currency)}</span></dd></>}
        <dt>By method</dt><dd>QR {peso(r.all.byMethod.QR?.amountCentavos ?? 0, r.currency)} · vouchers {peso(r.all.byMethod.VOUCHER?.amountCentavos ?? 0, r.currency)}<br /><span className="cap">{r.qrEnabled ? "Scan to pay is on" : "Scan to pay is off (no PayMongo key on the server)"}</span></dd>
        <dt>Vouchers</dt><dd>{r.unusedOneTimeVouchers} one-time unused</dd>
      </dl>
      <Link className="plain cap" href={`/transactions?eventId=${eventId}`}>All transactions →</Link>
    </section>
  );
}

// Sidebar (owner): which cashier accounts run this event.
export function EventCashiers({ event, cashiers }: { event: EventDto; cashiers: UserRow[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Set(event.cashiers.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const toggle = async (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next); setBusy(true); setMsg("");
    const r = await send("PUT", `/events/${event.id}/cashiers`, { adminIds: [...next] });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); setPicked(picked); } else router.refresh();
  };
  return (
    <section className="side-card" aria-labelledby="side-cashiers">
      <h2 id="side-cashiers">Cashiers</h2>
      {cashiers.length === 0 ? <p className="cap">No cashier accounts yet. Add one in Settings → Users with the Cashier role.</p> : (
        <ul className="side-list">
          {cashiers.map((u) => (
            <li key={u.id}>
              <label className="check"><input type="checkbox" checked={picked.has(u.id)} disabled={busy || u.disabled} onChange={() => toggle(u.id)} /><span>{u.username}{u.disabled ? " (disabled)" : ""}</span></label>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="cap err" role="alert">{msg}</p>}
    </section>
  );
}
