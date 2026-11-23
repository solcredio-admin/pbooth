"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { send } from "@/lib/client-api";
import type { EventDto, EventStatus, Transition } from "@/lib/types";

const ORDER: EventStatus[] = ["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "ARCHIVED"];
const LABELS: Record<EventStatus, string> = { DRAFT: "Draft", SCHEDULED: "Scheduled", ACTIVE: "Live", COMPLETED: "Completed", ARCHIVED: "Archived" };

const ACTIONS: Record<Transition, { label: string; cls: string; title: string; body: string }> = {
  schedule: { label: "Schedule", cls: "btn ghost", title: "Schedule this event?", body: "Marks the event as confirmed and on the calendar. You can still edit everything." },
  activate: { label: "Go live", cls: "btn go", title: "Make this event live?", body: "Live events are the ones booths will serve guests for. Do this when you're set up at the venue." },
  complete: { label: "Complete", cls: "btn", title: "Complete this event?", body: "Ends the event. If you complete it by mistake, you can make it live again." },
  archive: { label: "Archive", cls: "btn warn", title: "Archive this event?", body: "Archived events are hidden from the dashboard and become read-only. This can't be undone from the app." },
};

const HELP: Record<EventStatus, string> = {
  DRAFT: "Set up the details and guest experience, then schedule it or go live.",
  SCHEDULED: "Confirmed. Go live when you're set up at the venue.",
  ACTIVE: "This event is live. Complete it when the last guest has left.",
  COMPLETED: "Wrapped. Archive it once photos are delivered.",
  ARCHIVED: "Archived and read-only.",
};

// Status steps plus the moves allowed from here (the API enforces the same rules).
export function Lifecycle({ event, canEdit = true }: { event: EventDto; canEdit?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Transition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const at = ORDER.indexOf(event.status);

  const ask = (t: Transition) => { setPending(t); setError(""); dialog.current?.showModal(); };
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await send<EventDto>("POST", `/events/${event.id}/${pending}`);
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    dialog.current?.close();
    router.refresh();
  };
  const a = pending ? ACTIONS[pending] : null;

  return (
    <div className="lifecycle">
      <ol className="steps" aria-label="Event status">
        {ORDER.map((s, i) => (
          <li key={s} className={i < at ? "done" : i === at ? "now" : undefined} aria-current={i === at ? "step" : undefined}>{LABELS[s]}</li>
        ))}
      </ol>
      <p>{HELP[event.status]}</p>
      {canEdit && event.actions.length > 0 && (
        <div className="actions">
          {event.actions.map((t) => <button key={t} type="button" className={ACTIONS[t].cls} onClick={() => ask(t)}>{ACTIONS[t].label}</button>)}
        </div>
      )}
      <dialog ref={dialog} className="setup confirm" aria-labelledby="confirm-title" onClose={() => setPending(null)}>
        {a && (
          <>
            <span className="cap">{event.name}</span>
            <h2 id="confirm-title">{a.title}</h2>
            <p>{a.body}</p>
            {error && <p className="cap err" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
              <button type="button" className={a.cls} onClick={confirm} disabled={busy} autoFocus>{busy ? "Working…" : a.label}</button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
