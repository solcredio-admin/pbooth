import type { Metadata } from "next";
import Link from "next/link";
import { apiGet } from "@/lib/server-api";
import { SalesTabs } from "@/components/SalesTabs";
import { peso } from "@/lib/peso";
import type { EventDto, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Sales" };

interface Tx { id: string; createdAt: string; reference: string; event: string; timeZone: string; booth: string | null; method: "QR" | "VOUCHER" | "FREE"; status: string; amountCentavos: number; currency: string; voucherHint: string | null; providerRef: string | null }
interface TxPage { page: number; pageSize: number; total: number; totals: { sessions: number; grossCentavos: number; refundsCentavos: number; netCentavos: number; partnerShareCentavos: number }; booths: { id: string; name: string }[]; items: Tx[] }
const METHOD = { QR: "QR", VOUCHER: "Voucher", FREE: "Free" } as const;
const STATUS = { PAID: "Paid", REFUNDED: "Refunded", EXPIRED: "Not completed", FAILED: "Failed", PENDING: "Waiting" } as const;
const KEYS = ["eventId", "from", "to", "boothId", "method", "status", "q"] as const;

// Every self-service payment, filtered by the URL (so a view can be bookmarked), with totals and CSV.
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = Object.fromEntries(KEYS.map((k) => [k, sp[k]?.trim() ?? ""])) as Record<(typeof KEYS)[number], string>;
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...extra }).toString();
  const page = Math.max(1, Number(sp.page) || 1);
  const [data, events, open] = await Promise.all([
    apiGet<TxPage>(`/transactions?${query({ page: String(page) })}`),
    apiGet<Page<EventDto>>("/events?pageSize=100&order=desc"),
    apiGet<{ openCount: number }>("/refunds"),
  ]);
  const places = events.items.filter((e) => e.kind === "SELF_SERVICE");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const t = data.totals;
  const when = (x: Tx) => new Intl.DateTimeFormat("en-US", { timeZone: x.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(x.createdAt));
  return (
    <>
      <section className="hero compact"><span className="cap">{data.total} transaction{data.total === 1 ? "" : "s"}</span><h1>Sales.</h1></section>
      <main>
        <SalesTabs open={open.openCount} />
        <section className="host" aria-label="Transactions">
          <div className="panel">
            <form className="filters" action="/transactions" role="search">
              <label><span className="cap">Location</span><select name="eventId" defaultValue={f.eventId}><option value="">All locations</option>{places.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
              <label className="narrow"><span className="cap">From</span><input type="date" name="from" defaultValue={f.from} /></label>
              <label className="narrow"><span className="cap">To</span><input type="date" name="to" defaultValue={f.to} /></label>
              <label className="narrow"><span className="cap">Booth</span><select name="boothId" defaultValue={f.boothId}><option value="">Any</option>{data.booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="narrow"><span className="cap">Method</span><select name="method" defaultValue={f.method}><option value="">Any</option>{Object.entries(METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="narrow"><span className="cap">Status</span><select name="status" defaultValue={f.status}><option value="">Paid and refunded</option><option value="ALL">All</option>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="narrow"><span className="cap">Reference or voucher</span><input name="q" defaultValue={f.q} placeholder="7K3M-Q9TX" /></label>
              <button className="btn ghost" type="submit">Filter</button>
              {query() && <Link className="plain cap" href="/transactions">Clear</Link>}
            </form>
            <dl className="totals">
              <div><dt>Sessions</dt><dd>{t.sessions}</dd></div>
              <div><dt>Gross</dt><dd>{peso(t.grossCentavos)}</dd></div>
              <div><dt>Refunds</dt><dd>{peso(t.refundsCentavos)}</dd></div>
              <div><dt>Net</dt><dd>{peso(t.netCentavos)}</dd></div>
              <div><dt>Venue share</dt><dd>{peso(t.partnerShareCentavos)}</dd></div>
            </dl>
            {data.items.length === 0 ? <div className="empty-state"><h3>No transactions here.</h3><p>Self-service payments show up as guests pay.</p></div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>When</th><th>Reference</th><th className="hide-sm">Location</th><th className="hide-sm">Method</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.items.map((x) => (
                      <tr key={x.id}>
                        <td>{when(x)}</td>
                        <td><code>{x.reference}</code>{x.voucherHint && <div className="sub">voucher …{x.voucherHint}</div>}</td>
                        <td className="hide-sm">{x.event}<div className="sub">{x.booth ?? "—"}</div></td>
                        <td className="hide-sm">{METHOD[x.method]}</td>
                        <td>{peso(x.amountCentavos, x.currency)}</td>
                        <td>{STATUS[x.status as keyof typeof STATUS] ?? x.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <Link className="btn ghost" href={`/transactions?${query({ page: String(page - 1) })}`} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}>Previous</Link>
                <span className="cap">Page {page} of {pages}</span>
                <Link className="btn ghost" href={`/transactions?${query({ page: String(page + 1) })}`} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined}>Next</Link>
              </nav>
            )}
            <div className="actions start sales-actions">
              <a className="btn ghost" href={`/api/v1/transactions/export.csv?${query()}`}>Export CSV</a>
              <a className="plain cap" href={`/api/v1/transactions/export.csv?${query({ daily: "1" })}`}>One line per day</a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
