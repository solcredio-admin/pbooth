import type { Metadata } from "next";
import { BoothDetail } from "@/components/BoothDetail";
import { apiGet } from "@/lib/server-api";
import type { BoothDto, EventDto, Page, StationDto } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await apiGet<BoothDto>(`/booths/${(await params).id}`)).name };
}

export default async function BoothPage({ params }: Props) {
  const { id } = await params;
  const [booth, events, stations] = await Promise.all([
    apiGet<BoothDto>(`/booths/${id}`),
    apiGet<Page<EventDto>>("/events?pageSize=100&order=asc"),
    // kiosk operators can't list stations; they only see the booth's own
    apiGet<{ items: StationDto[] }>("/stations").catch(() => ({ items: [] })),
  ]);
  return <BoothDetail initial={booth} events={events.items} stations={stations.items} origin={process.env.APP_ORIGIN ?? "http://localhost:3000"} />;
}
