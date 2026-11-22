import type { Metadata } from "next";
import { EventLive } from "@/components/EventLive";
import { apiGet } from "@/lib/server-api";
import type { BoothDto, EventDto, EventSessions } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await apiGet<EventDto>(`/events/${(await params).id}`)).name} · Live` };
}

export default async function EventBoothsPage({ params }: Props) {
  const { id } = await params;
  const [event, booths, all] = await Promise.all([
    apiGet<EventDto>(`/events/${id}`),
    apiGet<{ items: BoothDto[]; sessions: EventSessions }>(`/events/${id}/booths`),
    apiGet<{ items: BoothDto[] }>("/booths"),
  ]);
  return <EventLive event={event} initial={booths.items} allBooths={all.items} initialSessions={booths.sessions} />;
}
