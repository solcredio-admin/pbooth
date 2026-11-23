"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import type { EventDto } from "@/lib/types";
import { can, useMe } from "@/lib/roles";

// Name + date is enough to start: the event opens as a draft (6–11 PM, this browser's time zone)
// and the event page takes it from there.
// Event editors only; everyone else sees the events, read-only.
export function QuickEvent() {
  return can(useMe().role).editEvents ? <QuickEventForm /> : null;
}

function QuickEventForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    if (!name) return setError("Give the event a name.");
    setBusy(true);
    const res = await send<EventDto>("POST", "/events", {
      name, date: String(f.get("date") || today), startTime: "18:00", endTime: "23:00",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setBusy(false);
    if (!res.ok) return setError(res.fields.name ?? res.fields.date ?? res.message);
    router.push(`/events/${res.data.id}`);
  }

  return (
    <section className="host" aria-labelledby="new-event">
      <div className="host-head">
        <span className="cap">Starts as a draft; set times, design and booths next</span>
        <h2 id="new-event">Add an event</h2>
      </div>
      <div className="panel">
        <form className="inline-form" onSubmit={create}>
          <label className="field"><span>Event name</span><input name="name" maxLength={120} placeholder="Reyes Wedding, Tan Corporate…" aria-invalid={error ? true : undefined} /></label>
          <label className="field narrow-field"><span>Date</span><input name="date" type="date" defaultValue={today} /></label>
          <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add event"}</button>
        </form>
        {error && <p className="cap err" role="alert">{error}</p>}
      </div>
    </section>
  );
}
