import type { Metadata } from "next";
import Link from "next/link";
import { apiGet } from "@/lib/server-api";
import { QuickEvent } from "@/components/QuickEvent";
import { longDate, STATUS_LABEL, timeRange } from "@/lib/format";
import type { EventDto, EventStatus, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Events" };
const STATUSES: EventStatus[] = ["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "ARCHIVED"];
const PAGE_SIZE = 20;

export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = STATUSES.includes(sp.status as EventStatus) ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(q ? { q } : {}), ...(status ? { status } : {}) });
  const data = await apiGet<Page<EventDto>>(`/events?${qs}`);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (p: number) => `/events?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  const filtered = Boolean(q || status);

  return (
    <>
      <section className="hero compact">
        <span className="cap">{data.total} {filtered ? "matching" : "in total"}</span>
        <h1>Events.</h1>
      </section>
      <main>
        <QuickEvent />
        <section className="host">
          <div className="panel">
            {/* A plain GET form: filters live in the URL, so they survive reloads and can be bookmarked. */}
            <form className="filters" action="/events" role="search">
              <label><span className="cap">Search</span><input name="q" defaultValue={q} placeholder="Name, organizer or venue" /></label>
              <label className="narrow"><span className="cap">Status</span>
                <select name="status" defaultValue={status}>
                  <option value="">Any status</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <button className="btn ghost" type="submit">Filter</button>
              {filtered && <Link className="plain cap" href="/events">Clear</Link>}
            </form>
            {data.items.length === 0 ? (
              <div className="empty-state">
                <h3>{filtered ? "No events match." : "No events yet."}</h3>
                <p>{filtered ? "Try another word or status." : "Create your first event to start setting up booths and guest experience."}</p>
                {!filtered && <Link className="btn" href="/events/new">Create an event</Link>}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Event</th><th>Date</th><th className="hide-sm">Venue</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id}>
                        <td><Link className="row-link name" href={`/events/${e.id}`}>{e.name}</Link>{e.organizerName && <div className="sub">{e.organizerName}</div>}</td>
                        <td>{longDate(e)}<div className="sub">{timeRange(e)}</div></td>
                        <td className="hide-sm">{e.venueName ?? "—"}</td>
                        <td><span className={`pill s-${e.status}`}>{STATUS_LABEL[e.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <Link className="btn ghost" href={link(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}>Previous</Link>
                <span className="cap">Page {page} of {pages}</span>
                <Link className="btn ghost" href={link(page + 1)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined}>Next</Link>
              </nav>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
