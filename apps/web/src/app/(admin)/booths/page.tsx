import type { Metadata } from "next";
import { BoothsBoard } from "@/components/BoothsBoard";
import { apiGet } from "@/lib/server-api";
import type { BoothDto } from "@/lib/types";

export const metadata: Metadata = { title: "Booths" };

export default async function BoothsPage() {
  const { items } = await apiGet<{ items: BoothDto[] }>("/booths");
  return <BoothsBoard initial={items} />;
}
