"use client";
import { useState } from "react";
import { send } from "@/lib/client-api";

// Pairs this browser as the booth's kiosk (the signed-in user is the proof) and opens it.
export function OpenKioskHere({ boothId, boothCode, className = "btn" }: { boothId: string; boothCode: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true); setError("");
    const r = await send("POST", `/booths/${boothId}/kiosk/launch`);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    location.assign(`/kiosk/${boothCode}`);
  };
  return (
    <>
      <button type="button" className={className} onClick={open} disabled={busy}>{busy ? "Opening…" : "Open kiosk here"}</button>
      {error && <span className="cap err" role="alert">{error}</span>}
    </>
  );
}
