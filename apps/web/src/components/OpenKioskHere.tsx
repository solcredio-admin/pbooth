"use client";
import { useState } from "react";
import { send } from "@/lib/client-api";

// Pairs this browser as the booth's kiosk (the signed-in user is the proof) and opens it in a new tab.
export function OpenKioskHere({ boothId, boothCode, className = "btn" }: { boothId: string; boothCode: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    // open the tab now, while it's still the click (browsers block pop-ups opened after a wait)
    const tab = window.open("about:blank", "_blank");
    setBusy(true); setError("");
    const r = await send("POST", `/booths/${boothId}/kiosk/launch`);
    setBusy(false);
    if (!r.ok) { tab?.close(); return setError(r.message); }
    if (tab) tab.location.href = `/kiosk/${boothCode}`; else location.assign(`/kiosk/${boothCode}`);
  };
  return (
    <>
      <button type="button" className={className} onClick={open} disabled={busy}>{busy ? "Opening…" : "Open kiosk here"}</button>
      {error && <span className="cap err" role="alert">{error}</span>}
    </>
  );
}
