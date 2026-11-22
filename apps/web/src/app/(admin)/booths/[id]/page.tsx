import type { Metadata } from "next";
import { BoothDetail } from "@/components/BoothDetail";
import { apiGet } from "@/lib/server-api";
import type { BoothDto, EventDto, Page } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await apiGet<BoothDto>(`/booths/${(await params).id}`)).name };
}

export default async function BoothPage({ params }: Props) {
  const { id } = await params;
  const [booth, events] = await Promise.all([
    apiGet<BoothDto>(`/booths/${id}`),
    apiGet<Page<EventDto>>("/events?pageSize=100&order=asc"),
  ]);
  return <BoothDetail initial={booth} events={events.items} origin={process.env.APP_ORIGIN ?? "http://localhost:3000"} />;
}
