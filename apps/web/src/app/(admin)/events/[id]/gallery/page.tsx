import type { Metadata } from "next";
import { EventGallery } from "@/components/EventGallery";
import { apiGet } from "@/lib/server-api";
import type { EventDto, EventPhotos } from "@/lib/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await apiGet<EventDto>(`/events/${(await params).id}`)).name} · Gallery` };
}

export default async function EventGalleryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [event, photos] = await Promise.all([apiGet<EventDto>(`/events/${id}`), apiGet<EventPhotos>(`/events/${id}/photos?page=${page}`)]);
  return <EventGallery event={event} data={photos} origin={process.env.APP_ORIGIN ?? "http://localhost:3000"} />;
}
