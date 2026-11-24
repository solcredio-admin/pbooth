"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { send } from "@/lib/client-api";

// Permanent delete, made deliberate: a button opens a dialog, and the delete button stays disabled
// until the exact name is typed (the API checks the name again).
export function DeleteZone({ what, name, path, back, lost, blocked }: {
  what: "event" | "booth" | "station";
  name: string;
  path: string; // API path, e.g. /events/<id>/delete
  back: string; // where to go afterwards
  lost: string; // what disappears, in one or two sentences
  blocked?: string; // why it can't be deleted right now
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = typed.trim() === name.trim();

  const open = () => { setTyped(""); setError(""); dialog.current?.showModal(); };
  const remove = async () => {
    if (!matches) return;
    setBusy(true);
    const res = await send("POST", path, { confirmName: typed });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    dialog.current?.close();
    router.replace(back);
    router.refresh();
  };

  return (
    <section className="host danger-zone" aria-labelledby={`del-${what}`}>
      <div className="host-head"><span className="cap">Permanent</span><h2 id={`del-${what}`}>Delete this {what}</h2></div>
      <div className="panel">
        <p className="cap center">{blocked ?? lost}</p>
        <div className="actions"><button className="btn warn" type="button" onClick={open} disabled={!!blocked}>Delete {what}…</button></div>
        <dialog ref={dialog} className="setup confirm" aria-labelledby={`del-${what}-title`}>
          <span className="cap">{name}</span>
          <h2 id={`del-${what}-title`}>Delete this {what} for good?</h2>
          <p>{lost} This can&apos;t be undone.</p>
          <form onSubmit={(ev) => { ev.preventDefault(); remove(); }}>
            <label className="field">
              <span className="cap">Type <b>{name}</b> to confirm</span>
              <input value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" spellCheck={false} autoFocus aria-describedby={error ? `del-${what}-err` : undefined} />
            </label>
            {error && <p id={`del-${what}-err`} className="cap err" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
              <button type="submit" className="btn warn" disabled={!matches || busy}>{busy ? "Deleting…" : `Delete ${what}`}</button>
            </div>
          </form>
        </dialog>
      </div>
    </section>
  );
}
