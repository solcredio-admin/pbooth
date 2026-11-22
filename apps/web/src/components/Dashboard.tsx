"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Ago } from "./Ago";
import { useLiveBooths } from "@/lib/live";
import type { BoothDto, EventDto, Summary } from "@/lib/types";
import { BOOTH_LABEL, BOOTH_SHORT, boothTile, capDate, longDate, STATUS_LABEL, STATUS_SHORT, timeRange } from "@/lib/format";

const tileClass = (e: EventDto) =>
  e.status === "ACTIVE" ? "key" : e.status === "SCHEDULED" ? "key sched" : e.status === "COMPLETED" ? "key local past" : "key local";

const GROUPS = [
  { title: "Live now", cap: "Running right now", match: (e: EventDto) => e.status === "ACTIVE" },
  { title: "Coming up", cap: "Scheduled and drafts", match: (e: EventDto) => e.status === "SCHEDULED" || e.status === "DRAFT" },
  { title: "Wrapped", cap: "Completed, ready to export", match: (e: EventDto) => e.status === "COMPLETED" },
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Hover = { kind: "event"; e: EventDto; top: boolean } | { kind: "booth"; b: BoothDto; top: boolean };

// The dashboard: events as keycaps grouped by status, then every booth, updating live.
export function Dashboard({ events, summary, booths: initialBooths }: { events: EventDto[]; summary: Summary; booths: BoothDto[] }) {
  const { booths } = useLiveBooths(initialBooths);
  const [hover, setHover] = useState<Hover | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const s = summary.byStatus;
  const online = booths.filter((b) => b.online).length;

  const top = (el: HTMLElement) => el.getBoundingClientRect().bottom > innerHeight - 190; // don't cover the tile being looked at
  const openEvent = (e: EventDto, el: HTMLElement) => { clearTimeout(closing.current); setHover({ kind: "event", e, top: top(el) }); };
  const openBooth = (b: BoothDto, el: HTMLElement) => { clearTimeout(closing.current); setHover({ kind: "booth", b, top: top(el) }); };
  const close = () => { closing.current = setTimeout(() => setHover(null), 220); };

  return (
    <>
      <section className="hero compact">
        <h1>Dashboard.</h1>
        <div className="cap answer" role="status">
          <span className="free">{s.ACTIVE} live</span> · {s.SCHEDULED} scheduled · {plural(s.DRAFT, "draft")} · {online}/{booths.length} booths online
        </div>
      </section>
      <main id="cards">
        {events.length === 0 ? (
          <section className="host" aria-labelledby="no-events">
            <div className="host-head"><span className="cap">Events</span><h2 id="no-events">No events yet</h2></div>
            <div className="panel"><div className="actions"><Link className="btn" href="/events/new">Create an event</Link></div></div>
          </section>
        ) : GROUPS.map((g) => {
          const list = events.filter(g.match);
          if (!list.length) return null;
          return (
            <section className="host" key={g.title} aria-labelledby={`g-${g.title}`}>
              <div className="host-head">
                <span className="cap">{g.cap} · {plural(list.length, "event")}</span>
                <h2 id={`g-${g.title}`}>{g.title}</h2>
              </div>
              <div className="panel">
                <div className="keys">
                  {list.map((e) => (
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
              </div>
            </section>
          );
        })}

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

        <div className="legend-row cap" aria-hidden="true">
          <span><i className="lg-live" />Live / online</span>
          <span><i className="lg-sched" />Scheduled / enrolled</span>
          <span><i className="lg-cap" />Draft, completed or offline</span>
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
              <dt>Venue</dt><dd>{hover.e.venueName ?? "—"}</dd>
              <dt>Organizer</dt><dd>{hover.e.organizerName ?? "—"}</dd>
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
