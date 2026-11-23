import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventForm } from "@/components/EventForm";
import { apiGet } from "@/lib/server-api";
import type { Me } from "@/lib/roles";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage() {
  const { admin } = await apiGet<{ admin: Me }>("/auth/me");
  if (admin.role !== "OWNER" && admin.role !== "EVENTS") redirect("/events"); // the API refuses it anyway
  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href="/events">← Events</Link>
        <div>
          <div className="title-row"><h1>A new event.</h1><span className="pill s-DRAFT">Draft</span></div>
          <div className="meta cap"><span>It starts as a draft. Nothing goes live until you say so.</span></div>
        </div>
      </section>
      <main className="detail single">
        <div className="detail-main">
          <section className="host"><div className="panel"><EventForm /></div></section>
        </div>
      </main>
    </>
  );
}
