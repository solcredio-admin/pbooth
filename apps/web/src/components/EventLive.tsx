"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BoothCard } from "./BoothCard";
import { send } from "@/lib/client-api";
import { useLiveBooths } from "@/lib/live";
import { longDate, STATUS_LABEL, timeRange } from "@/lib/format";
import type { BoothDto, EventDto, EventSessions } from "@/lib/types";
import { can, useMe } from "@/lib/roles";

// The live view of one event: its booths, updating as they check in, plus booking controls.
export function EventLive({ event, initial, allBooths, initialSessions }: { event: EventDto; initial: BoothDto[]; allBooths: BoothDto[]; initialSessions: EventSessions }) {
  const router = useRouter();
  const { booths, connected, sessions } = useLiveBooths(initial, (b) => b.events.some((e) => e.id === event.id), { eventId: event.id, initial: initialSessions });
  const total = sessions?.total ?? { sessions: 0, completed: 0, photos: 0 };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const book = can(useMe().role).bookBooths; // kiosk operators watch, they don't book
  const closed = event.status === "COMPLETED" || event.status === "ARCHIVED";
  const assigned = new Set(booths.map((b) => b.id));
  const choices = allBooths.filter((b) => !assigned.has(b.id) && b.state !== "REVOKED");
  const online = booths.filter((b) => b.online).length;
  const problems = booths.filter((b) => b.status === "ERROR" || (event.status === "ACTIVE" && !b.online)).length;
  const pendingUploads = booths.reduce((n, b) => n + (b.device?.telemetry.pendingUploads ?? 0), 0);

  const run = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    const res = await send(method, path, body);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setError("");
    router.refresh();
  };

  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href={`/events/${event.id}`}>← {event.name}</Link>
        <div>
          <div className="title-row">
            <h1>{event.status === "ACTIVE" ? "Live now." : "Booths."}</h1>
            <span className={`pill s-${event.status}`}>{STATUS_LABEL[event.status]}</span>
          </div>
          <div className="meta cap">
            <span><span className={"live-dot" + (connected ? " on" : "")} aria-hidden="true" />{connected ? "Updating live" : "Connecting…"}</span>
            <span>{longDate(event)}</span><span>{timeRange(event)}</span>
          </div>
        </div>
        <div className="cap answer head-summary" role="status">
          <span className="free">{online} of {booths.length} online</span>
          {" · "}{total.completed} guest session{total.completed === 1 ? "" : "s"} · {total.photos} photo{total.photos === 1 ? "" : "s"}
          {problems > 0 && <> · <span className="taken">{problems} need attention</span></>}
          {" · "}{pendingUploads} uploads pending
        </div>
      </section>
      <main>
        {booths.length === 0 ? (
          <section className="host"><div className="panel"><div className="empty-state">
            <h3>No booths booked.</h3>
            <p>{allBooths.length ? "Add a booth below. It gets this event's settings once the event is live." : "Register a booth first, then book it here."}</p>
            {!allBooths.length && <Link className="btn" href="/booths">Go to booths</Link>}
          </div></div></section>
        ) : (
          <div className="booth-grid">
            {booths.map((b) => (
              <BoothCard key={b.id} b={b} stats={sessions?.byBooth[b.id] ?? { sessions: 0, completed: 0, photos: 0 }} action={!closed && book && (
                <button type="button" className="plain cap" disabled={busy} onClick={() => run("DELETE", `/events/${event.id}/booths/${b.id}`)}>Remove from event</button>
              )} />
            ))}
          </div>
        )}
        {!closed && book && choices.length > 0 && (
          <section className="host" aria-labelledby="book">
            <div className="host-head"><span className="cap">Booths you've registered</span><h2 id="book">Book a booth</h2></div>
            <div className="panel">
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const id = String(new FormData(e.currentTarget).get("boothId") ?? ""); if (id) run("POST", `/events/${event.id}/booths`, { boothId: id }); }}>
                <label className="field"><span>Booth</span>
                  <select name="boothId" defaultValue="">
                    <option value="" disabled>Choose a booth…</option>
                    {choices.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.code}{b.simulated ? " (simulated)" : ""}{b.liveEvent ? ` · live at ${b.liveEvent.name}` : ""}</option>)}
                  </select>
                </label>
                <button className="btn ghost" type="submit" disabled={busy}>Add</button>
              </form>
            </div>
          </section>
        )}
        {error && <p className="notice cap" role="alert">{error}</p>}
      </main>
    </>
  );
}
