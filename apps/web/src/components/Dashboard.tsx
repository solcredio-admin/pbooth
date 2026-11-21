"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { EventDto, Summary } from "@/lib/types";
import { capDate, longDate, STATUS_LABEL, STATUS_SHORT, timeRange } from "@/lib/format";

const tileClass = (e: EventDto) =>
  e.status === "ACTIVE" ? "key" : e.status === "SCHEDULED" ? "key sched" : e.status === "COMPLETED" ? "key local past" : "key local";

const GROUPS = [
  { title: "Live now", cap: "Running right now", match: (e: EventDto) => e.status === "ACTIVE" },
  { title: "Coming up", cap: "Scheduled and drafts", match: (e: EventDto) => e.status === "SCHEDULED" || e.status === "DRAFT" },
  { title: "Wrapped", cap: "Completed, ready to export later", match: (e: EventDto) => e.status === "COMPLETED" },
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The dashboard: one question with an inline search, and events as keycaps grouped by status.
export function Dashboard({ events, summary }: { events: EventDto[]; summary: Summary }) {
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<{ e: EventDto; top: boolean } | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const needle = q.trim().toLowerCase();
  const matches = (e: EventDto) => !needle || [e.name, e.organizerName, e.venueName].some((v) => v?.toLowerCase().includes(needle));
  const shown = useMemo(() => events.filter(matches), [events, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = summary.byStatus;

  const open = (e: EventDto, el: HTMLElement) => {
    clearTimeout(closing.current);
    const r = el.getBoundingClientRect();
    setHover({ e, top: r.bottom > innerHeight - 190 }); // don't cover the tile being looked at
  };
  const close = () => { closing.current = setTimeout(() => setHover(null), 220); };

  if (events.length === 0) {
    return (
      <>
        <section className="hero">
          <h1>Your first event starts here.</h1>
          <Link className="btn" href="/events/new">Create an event</Link>
        </section>
        <main />
      </>
    );
  }

  return (
    <>
      <section className="hero">
        <h1>
          Find <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="any" aria-label="Search events" size={Math.max(3, q.length + 1)} /> among {plural(events.length, "event")}.
        </h1>
        <div className="cap answer" role="status">
          {needle
            ? shown.length ? <><b>{plural(shown.length, "match")}</b> <span className="muted">for “{q.trim()}”</span></> : <span className="muted">No event matches “{q.trim()}”</span>
            : <><span className="free">{b.ACTIVE} live</span> · {b.SCHEDULED} scheduled · {plural(b.DRAFT, "draft")}</>}
        </div>
      </section>
      <main id="cards">
        {GROUPS.map((g) => {
          const list = events.filter(g.match);
          if (!list.length) return null;
          const visible = list.filter(matches).length;
          return (
            <section className="host" key={g.title} aria-labelledby={`g-${g.title}`}>
              <div className="host-head">
                <span className="cap">{g.cap} · {plural(needle ? visible : list.length, "event")}</span>
                <h2 id={`g-${g.title}`}>{g.title}</h2>
              </div>
              <div className="panel">
                <div className="keys">
                  {list.map((e) => (
                    <Link
                      key={e.id}
                      href={`/events/${e.id}`}
                      className={tileClass(e) + (matches(e) ? "" : " hidden-by-search")}
                      onMouseEnter={(ev) => open(e, ev.currentTarget)}
                      onMouseLeave={close}
                      onFocus={(ev) => open(e, ev.currentTarget)}
                      onBlur={close}
                      aria-label={`${e.name}, ${STATUS_LABEL[e.status]}, ${longDate(e)}`}
                    >
                      <span className="p">{STATUS_SHORT[e.status]}</span>
                      <span className="n">{capDate(e)}</span>
                      <span className="l">{e.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
        {needle && shown.length === 0 && <p className="cap empty">Nothing here. Try a venue or organizer name.</p>}
        <div className="legend-row cap" aria-hidden="true">
          <span><i className="lg-live" />Live</span>
          <span><i className="lg-sched" />Scheduled</span>
          <span><i className="lg-cap" />Draft / completed</span>
        </div>
      </main>
      <div className={"ticket" + (hover?.top ? " top" : "")} hidden={!hover} role="tooltip">
        {hover && (
          <>
            <span className="cap">{STATUS_LABEL[hover.e.status]} · {hover.e.timeZone}</span>
            <h3>{hover.e.name}</h3>
            <dl>
              <dt>When</dt><dd>{longDate(hover.e)}{"\n"}{timeRange(hover.e)}</dd>
              <dt>Venue</dt><dd>{hover.e.venueName ?? "—"}</dd>
              <dt>Organizer</dt><dd>{hover.e.organizerName ?? "—"}</dd>
            </dl>
          </>
        )}
      </div>
    </>
  );
}
