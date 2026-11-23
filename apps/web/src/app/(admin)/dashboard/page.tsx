import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";
import { redirect } from "next/navigation";
import { apiGet } from "@/lib/server-api";
import type { Me } from "@/lib/roles";
import type { BoothDto, EventDto, Page, Summary } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { admin } = await apiGet<{ admin: Me }>("/auth/me");
  if (admin.role === "CASHIER") redirect("/events"); // cashiers work in their own events
  // shortcut: the dashboard shows up to 100 upcoming/recent events; add paging if that's ever not enough.
  const [list, summary, booths] = await Promise.all([
    apiGet<Page<EventDto>>("/events?pageSize=100&order=asc"),
    apiGet<Summary>("/events/summary"),
    apiGet<{ items: BoothDto[] }>("/booths"),
  ]);
  return <Dashboard events={list.items.filter((e) => e.status !== "ARCHIVED")} summary={summary} booths={booths.items} />;
}
