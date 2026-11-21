import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";
import { apiGet } from "@/lib/server-api";
import type { EventDto, Page, Summary } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // shortcut: the dashboard shows up to 100 upcoming/recent events; add paging if that's ever not enough.
  const [list, summary] = await Promise.all([
    apiGet<Page<EventDto>>("/events?pageSize=100&order=asc"),
    apiGet<Summary>("/events/summary"),
  ]);
  return <Dashboard events={list.items.filter((e) => e.status !== "ARCHIVED")} summary={summary} />;
}
