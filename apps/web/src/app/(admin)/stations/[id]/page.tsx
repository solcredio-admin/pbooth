import type { Metadata } from "next";
import { StationDetail } from "@/components/StationDetail";
import { apiGet } from "@/lib/server-api";
import type { PrintJobDto, StationDto } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await apiGet<StationDto>(`/stations/${(await params).id}`)).name };
}

export default async function StationPage({ params }: Props) {
  const { id } = await params;
  const [station, all, jobs] = await Promise.all([
    apiGet<StationDto>(`/stations/${id}`), apiGet<{ items: StationDto[] }>("/stations"), apiGet<{ items: PrintJobDto[] }>(`/stations/jobs?stationId=${id}`),
  ]);
  return <StationDetail station={station} all={all.items} jobs={jobs.items} origin={process.env.APP_ORIGIN ?? "http://localhost:3000"} />;
}
