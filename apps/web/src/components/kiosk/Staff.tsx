"use client";
import { useEffect, useRef, useState } from "react";

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const BACK = "M21 5H9l-7 7 7 7h12zM17 9l-6 6M11 9l6 6", OK = "m5 12 5 5L20 7";
import { kioskFetch } from "@/lib/kiosk/api";

const HOLD_MS = 3000;

/** The staff's way out: hold the top-left corner for 3 seconds, then the booth's PIN. Guests see nothing. */
export function Staff() {
  const [open, setOpen] = useState<"pin" | "menu" | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drop = () => clearTimeout(hold.current);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !dlg.current?.open) dlg.current?.showModal(); }, [open]);
  useEffect(() => { if (!open) return; const t = setTimeout(() => { setOpen(null); setPin(""); }, 30_000); return () => clearTimeout(t); }, [open, pin]); // never left open for a guest
  const check = async () => {
    setError("");
    const r = await kioskFetch("POST", "/kiosk/staff", { pin });
    setPin("");
    if (r.ok) setOpen("menu");
    else setError(r.status === 0 ? "No internet: the PIN can't be checked" : r.status === 429 ? "Too many tries. Wait 15 minutes." : "That PIN isn't right");
  };
  return (
    <>
      <div className="k-corner" aria-hidden="true" onPointerDown={() => { drop(); hold.current = setTimeout(() => { setError(""); setPin(""); setOpen("pin"); }, HOLD_MS); }} onPointerUp={drop} onPointerLeave={drop} onPointerCancel={drop} />
      {open && (
        <dialog ref={dlg} className="k-staff" aria-label="Staff" onClose={() => setOpen(null)}>
          <div className="k-panel">
            {open === "pin" ? <>
              <h1 className="k-title small">Staff</h1>
              <p className="k-ref big" aria-label={`${pin.length} digits`}>{"•".repeat(pin.length) || "PIN"}</p>
              <div className="k-pins">{"123456789".split("").map((d) => <button key={d} className="k-key" type="button" onClick={() => setPin((p) => (p + d).slice(0, 8))}>{d}</button>)}
                <button className="k-key" type="button" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}><Icon d={BACK} /></button><button className="k-key" type="button" onClick={() => setPin((p) => (p + "0").slice(0, 8))}>0</button>
                <button className="k-key" type="button" aria-label="Enter" disabled={pin.length < 4} onClick={check}><Icon d={OK} /></button></div>
              {error && <p className="k-error" role="alert">{error}</p>}
            </> : <>
              <h1 className="k-title small">Staff menu</h1>
              <div className="k-actions col">
                <button className="k-btn" type="button" onClick={() => location.reload()}>Reload the kiosk</button>
                <button className="k-btn ghost" type="button" onClick={() => { void document.exitFullscreen?.().catch(() => undefined); setOpen(null); }}>Leave full screen</button>
                <button className="k-btn ghost" type="button" onClick={() => { location.href = "/booths"; }}>Go to the admin</button>
              </div>
            </>}
            <button className="k-btn ghost" type="button" onClick={() => dlg.current?.close()}>Close</button>
          </div>
        </dialog>
      )}
    </>
  );
}
