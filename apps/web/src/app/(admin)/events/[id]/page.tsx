import type { Metadata } from "next";
import Link from "next/link";
import { EventForm } from "@/components/EventForm";
import { Lifecycle } from "@/components/Lifecycle";
import { DeleteZone } from "@/components/DeleteZone";
import { apiGet } from "@/lib/server-api";
import { BOOTH_LABEL, longDate, STATUS_LABEL, timeRange } from "@/lib/format";
import type { BoothDto, EventDto } from "@/lib/types";
import type { Me } from "@/lib/roles";

type Props = { params: Promise<{ id: string }> };

const LAYOUT_LABEL = { landscape: "4R landscape", strip: "2×6 strips (two per sheet)", grid: "4R portrait grid" } as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const e = await apiGet<EventDto>(`/events/${(await params).id}`);
  return { title: e.name };
}

// One event at a glance: title and status on top, settings in the middle, status on the right.
export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const [e, booths, { admin }] = await Promise.all([apiGet<EventDto>(`/events/${id}`), apiGet<{ items: BoothDto[] }>(`/events/${id}/booths`), apiGet<{ admin: Me }>("/auth/me")]);
  const canEdit = admin.role === "OWNER" || admin.role === "EVENTS"; // the API enforces this too
  const online = booths.items.filter((b) => b.online).length;
  const c = e.config;
  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href="/events">← Events</Link>
        <div>
          <div className="title-row">
            <h1>{e.name}</h1>
            <span className={`pill s-${e.status}`}>{STATUS_LABEL[e.status]}</span>
          </div>
          <div className="meta cap">
            <span>{longDate(e)}</span><span>{timeRange(e)}</span>
          </div>
        </div>
        <div className="head-actions">
          <Link className={e.status === "ACTIVE" ? "btn go" : "btn ghost"} href={`/events/${e.id}/booths`}>
            {e.status === "ACTIVE" ? "Open live view" : "Booths"} · {booths.items.length ? `${online}/${booths.items.length} online` : "none booked"}
          </Link>
          {canEdit && <Link className="plain" href={`/events/${e.id}/gallery`}>Gallery &amp; export</Link>}
        </div>
      </section>
      <main className="detail">
        <div className="detail-main">
          <section className="host" aria-label="Event settings">
            <div className="panel"><EventForm key={e.updatedAt} event={e} canEdit={canEdit} /></div>
          </section>
        </div>
        <aside className="detail-side" aria-label="Event status">
          <section className="side-card" aria-labelledby="side-life">
            <h2 id="side-life">Lifecycle</h2>
            <Lifecycle event={e} canEdit={canEdit} />
          </section>
          {(e.organizerName || e.contactPhone || e.contactEmail) && (
            <section className="side-card" aria-labelledby="side-contact">
              <h2 id="side-contact">Contact</h2>
              <dl className="kv">
                {e.organizerName && <><dt>Client</dt><dd>{e.organizerName}</dd></>}
                {e.contactPhone && <><dt>Phone</dt><dd><a href={`tel:${e.contactPhone.replace(/[^\d+]/g, "")}`}>{e.contactPhone}</a></dd></>}
                {e.contactEmail && <><dt>Email</dt><dd><a href={`mailto:${e.contactEmail}`}>{e.contactEmail}</a></dd></>}
                {e.venueName && <><dt>Venue</dt><dd>{e.venueName}{e.venueAddress && <><br /><span className="cap">{e.venueAddress}</span></>}</dd></>}
              </dl>
            </section>
          )}
          <section className="side-card" aria-labelledby="side-booths">
            <h2 id="side-booths">Booths · {online} of {booths.items.length} online</h2>
            {booths.items.length === 0 ? (
              <p className="cap">No booth booked yet.</p>
            ) : (
              <ul className="side-list">
                {booths.items.map((b) => (
                  <li key={b.id}>
                    <span className={"dot" + (b.status === "ERROR" ? " err" : b.online ? " on" : "")} aria-hidden="true" />
                    <Link href={`/booths/${b.id}`}>{b.name}</Link>
                    <span className="sub">{b.simulated ? "Sim" : BOOTH_LABEL[b.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="plain cap" href={`/events/${e.id}/booths`}>{booths.items.length ? "Manage booths →" : "Book a booth →"}</Link>
          </section>
          {c && (
            <section className="side-card" aria-labelledby="side-glance">
              <h2 id="side-glance">At a glance</h2>
              <dl className="kv">
                <dt>Photos</dt><dd>{c.shotsPerSession} per guest · {c.countdownSeconds}s countdown</dd>
                <dt>Design</dt><dd>{LAYOUT_LABEL[c.layout] ?? c.layout}</dd>
                <dt>Printing</dt><dd>{c.printEnabled ? `On · ${c.printCopies} cop${c.printCopies === 1 ? "y" : "ies"}` : "Off"}</dd>
                <dt>Gallery</dt><dd>{c.galleryEnabled ? `QR links · kept ${c.galleryRetentionDays} days` : "Off"}</dd>
                <dt>Saving</dt><dd>{c.saveOriginals ? "Design + every photo" : "Design only"}</dd>
                <dt>Time zone</dt><dd>{e.timeZone}</dd>
              </dl>
            </section>
          )}
          {canEdit && (e.status === "DRAFT" || e.status === "SCHEDULED") && (
            // events that ran are kept for the record (retention still clears their photos)
            <DeleteZone what="event" name={e.name} path={`/events/${e.id}/delete`} back="/events"
              lost="For a wrong draft or a cancelled booking: removes the event, its settings and its booth bookings." />
          )}
        </aside>
      </main>
    </>
  );
}
