import type { Metadata } from "next";
import Link from "next/link";
import { EventForm } from "@/components/EventForm";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() {
  return (
    <>
      <section className="hero compact">
        <Link className="plain cap back" href="/events">← Events</Link>
        <h1>A new event.</h1>
        <span className="cap">It starts as a draft. Nothing goes live until you say so.</span>
      </section>
      <main className="narrow">
        <section className="host"><div className="panel"><EventForm /></div></section>
      </main>
    </>
  );
}
