import type { Metadata } from "next";
import Link from "next/link";
import { EventForm } from "@/components/EventForm";
import { Lifecycle } from "@/components/Lifecycle";
import { apiGet } from "@/lib/server-api";
import { longDate, STATUS_LABEL, timeRange } from "@/lib/format";
import type { BoothDto, EventDto } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const e = await apiGet<EventDto>(`/events/${(await params).id}`);
  return { title: e.name };
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const [e, booths] = await Promise.all([apiGet<EventDto>(`/events/${id}`), apiGet<{ items: BoothDto[] }>(`/events/${id}/booths`)]);
  const online = booths.items.filter((b) => b.online).length;
  return (
    <>
      <section className="hero compact">
        <Link className="plain cap back" href="/events">← Events</Link>
        <h1>{e.name}</h1>
        <div className="meta cap">
          <span>{longDate(e)}</span><span>{timeRange(e)}</span>
          {e.venueName && <span>{e.venueName}</span>}
          {e.organizerName && <span>For {e.organizerName}</span>}
        </div>
        <span className={`pill s-${e.status}`}>{STATUS_LABEL[e.status]}</span>
        <Link className={e.status === "ACTIVE" ? "btn go" : "btn ghost"} href={`/events/${e.id}/booths`}>
          {e.status === "ACTIVE" ? "Open live view" : "Booths"} · {booths.items.length ? `${online}/${booths.items.length} online` : "none booked"}
        </Link>
      </section>
      <main className="narrow">
        <section className="host" aria-labelledby="life">
          <div className="host-head"><span className="cap">Where it stands</span><h2 id="life">Lifecycle</h2></div>
          <div className="panel"><Lifecycle event={e} /></div>
        </section>
        <section className="host" aria-labelledby="det">
          <div className="host-head"><span className="cap">Everything about this event</span><h2 id="det">Details</h2></div>
          <div className="panel"><EventForm key={e.updatedAt} event={e} /></div>
        </section>
      </main>
    </>
  );
}
