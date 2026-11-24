import type { Metadata } from "next";
import { StationsBoard } from "@/components/StationsBoard";
import { apiGet } from "@/lib/server-api";
import type { PrintJobDto, StationDto } from "@/lib/types";

export const metadata: Metadata = { title: "Stations" };

export default async function StationsPage() {
  const [stations, open, done] = await Promise.all([
    apiGet<{ items: StationDto[] }>("/stations"), apiGet<{ items: PrintJobDto[] }>("/stations/jobs"), apiGet<{ items: PrintJobDto[] }>("/stations/jobs?status=done"),
  ]);
  return <StationsBoard stations={stations.items} open={open.items} done={done.items} />;
}
