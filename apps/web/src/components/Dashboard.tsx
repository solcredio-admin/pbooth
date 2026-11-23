"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Ago } from "./Ago";
import { useLiveBooths } from "@/lib/live";
import type { BoothDto, EventDto, Summary } from "@/lib/types";
import { BOOTH_LABEL, BOOTH_SHORT, boothTile, capDate, longDate, STATUS_LABEL, STATUS_SHORT, timeRange } from "@/lib/format";

const tileClass = (e: EventDto) =>
  e.status === "ACTIVE" ? "key" : e.status === "SCHEDULED" ? "key sched" : e.status === "COMPLETED" ? "key done" : "key local";

// Filters on the Events box. Wrapped (completed) events stay hidden unless asked for, so the next
// event is always the first tile.
type Filter = "ACTIVE" | "SCHEDULED" | "DRAFT" | "COMPLETED";
const FILTERS: { key: Filter; label: string; dot: string }[] = [
  { key: "ACTIVE", label: "live", dot: "lg-live" },
  { key: "SCHEDULED", label: "scheduled", dot: "lg-sched" },
  { key: "DRAFT", label: "draft", dot: "lg-cap" },
  { key: "COMPLETED", label: "wrapped", dot: "lg-done" },
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Hover = { kind: "event"; e: EventDto; top: boolean } | { kind: "booth"; b: BoothDto; top: boolean };

// The dashboard: booths (live) on top, then one Events box sorted by date with status filters.
export function Dashboard({ events, summary, booths: initialBooths }: { events: EventDto[]; summary: Summary; booths: BoothDto[] }) {
  const { booths } = useLiveBooths(initialBooths);
  const [hover, setHover] = useState<Hover | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const s = summary.byStatus;
  const online = booths.filter((b) => b.online).length;
  const [filter, setFilter] = useState<Filter | null>(null);
  const shown = events
    .filter((e) => (filter ? e.status === filter : e.status !== "COMPLETED"))
    .sort((a, b) => (filter === "COMPLETED" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));

  const top = (el: HTMLElement) => el.getBoundingClientRect().bottom > innerHeight - 190; // don't cover the tile being looked at
  const openEvent = (e: EventDto, el: HTMLElement) => { clearTimeout(closing.current); setHover({ kind: "event", e, top: top(el) }); };
  const openBooth = (b: BoothDto, el: HTMLElement) => { clearTimeout(closing.current); setHover({ kind: "booth", b, top: top(el) }); };
  const close = () => { closing.current = setTimeout(() => setHover(null), 220); };

  return (
    <>
      <section className="hero compact">
        <h1>Dashboard.</h1>
        <div className="cap answer filters-chip" role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={"chip-filter" + (filter === f.key ? " on" : "")} aria-pressed={filter === f.key}
              onClick={() => setFilter((cur) => (cur === f.key ? null : f.key))}>
              <i className={f.dot} aria-hidden="true" />{s[f.key]} {f.label}
            </button>
          ))}
          <span className="chip-sep" aria-hidden="true">·</span>
          <span>{online}/{booths.length} booths online</span>
        </div>
      </section>
      <main id="cards">
        <section className="host" aria-labelledby="g-booths">
          <div className="host-head">
            <span className="cap">{booths.length ? `${online} of ${plural(booths.length, "booth")} online` : "Physical kits you reuse across events"}</span>
            <h2 id="g-booths">Booths</h2>
          </div>
          <div className="panel">
            {booths.length === 0 ? (
              <div className="actions"><Link className="btn" href="/booths">Add a booth</Link></div>
            ) : (
              <div className="keys">
                {booths.map((b) => (
                  <Link
                    key={b.id}
                    href={b.liveEvent ? `/events/${b.liveEvent.id}/booths` : `/booths/${b.id}`}
                    className={boothTile(b)}
                    onMouseEnter={(ev) => openBooth(b, ev.currentTarget)} onMouseLeave={close}
                    onFocus={(ev) => openBooth(b, ev.currentTarget)} onBlur={close}
                    aria-label={`${b.name}, ${BOOTH_LABEL[b.status]}${b.simulated ? ", simulated" : ""}`}
                  >
                    <span className="p">{b.simulated ? "Sim" : BOOTH_SHORT[b.status]}</span>
                    <span className="n">{b.code.replace(/^PB-/, "")}</span>
                    <span className="l">{b.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="host" aria-labelledby="g-events">
          <div className="host-head">
            <span className="cap">
              {filter ? `${FILTERS.find((f) => f.key === filter)!.label} only · ${plural(shown.length, "event")}` : `Next first · ${plural(shown.length, "event")} · wrapped hidden`}
              {filter && <> · <button type="button" className="plain cap linkish" onClick={() => setFilter(null)}>show all</button></>}
            </span>
            <h2 id="g-events">Events</h2>
          </div>
          <div className="panel">
            {events.length === 0 ? (
              <div className="actions"><Link className="btn" href="/events">Add an event</Link></div>
            ) : shown.length === 0 ? (
              <p className="cap center">No {filter ? FILTERS.find((f) => f.key === filter)!.label : "upcoming"} events.</p>
            ) : (
              <div className="keys">
                {shown.map((e) => (
                  <Link
                    key={e.id}
                    href={e.status === "ACTIVE" ? `/events/${e.id}/booths` : `/events/${e.id}`}
                    className={tileClass(e)}
                    onMouseEnter={(ev) => openEvent(e, ev.currentTarget)} onMouseLeave={close}
                    onFocus={(ev) => openEvent(e, ev.currentTarget)} onBlur={close}
                    aria-label={`${e.name}, ${STATUS_LABEL[e.status]}, ${longDate(e)}`}
                  >
                    <span className="p">{STATUS_SHORT[e.status]}</span>
                    <span className="n">{capDate(e)}</span>
                    <span className="l">{e.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="legend-row cap" aria-hidden="true">
          <span><i className="lg-live" />Live / online</span>
          <span><i className="lg-sched" />Scheduled / enrolled</span>
          <span><i className="lg-cap" />Draft / offline</span>
          <span><i className="lg-done" />Wrapped</span>
          <span><i className="lg-err" />Booth error</span>
        </div>
      </main>
      <div className={"ticket" + (hover?.top ? " top" : "")} hidden={!hover} role="tooltip">
        {hover?.kind === "event" && (
          <>
            <span className="cap">{STATUS_LABEL[hover.e.status]} · {hover.e.timeZone}</span>
            <h3>{hover.e.name}</h3>
            <dl>
              <dt>When</dt><dd>{longDate(hover.e)}{"\n"}{timeRange(hover.e)}</dd>
              <dt>Venue</dt><dd>{[hover.e.venueName, hover.e.venueAddress].filter(Boolean).join("\n") || "—"}</dd>
              <dt>Organizer</dt><dd>{hover.e.organizerName ?? "—"}</dd>
              <dt>Contact</dt><dd>{[hover.e.contactPhone, hover.e.contactEmail].filter(Boolean).join("\n") || "—"}</dd>
            </dl>
          </>
        )}
        {hover?.kind === "booth" && (
          <>
            <span className="cap">{BOOTH_LABEL[hover.b.status]}{hover.b.simulated ? " · Simulated" : ""} · {hover.b.code}</span>
            <h3>{hover.b.name}</h3>
            <dl>
              <dt>Last seen</dt><dd><Ago iso={hover.b.lastSeenAt} /></dd>
              <dt>Event</dt><dd>{hover.b.liveEvent?.name ?? hover.b.nextEvent?.name ?? "—"}</dd>
              <dt>Problem</dt><dd>{hover.b.lastError ?? "—"}</dd>
            </dl>
          </>
        )}
      </div>
    </>
  );
}
