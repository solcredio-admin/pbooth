"use client";
import { useEffect, useState } from "react";
import { kioskFetch } from "@/lib/kiosk/api";
import { peso } from "@/lib/peso";
import { Keypad } from "./Keypad";

const REASONS = [["NO_SESSION", "I paid, but no session started"], ["NO_PRINT", "My photos didn't print"], ["OTHER", "Something else"]] as const;
interface Recent { id: string; paidAt: string; amountCentavos: number; currency: string }

/** "Need help or a refund?" at a self-service booth. Nothing about the guest is collected but their payment reference. */
export function Help({ onClose }: { onClose: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ reference: string | null } | null>(null);
  useEffect(() => { void kioskFetch<{ items: Recent[] }>("GET", "/kiosk/help").then((r) => { if (r.ok) setRecent(r.data.items); }); }, []);
  useEffect(() => { if (!sent) return; const t = setTimeout(onClose, 20_000); return () => clearTimeout(t); }, [sent, onClose]);
  const ask = async (by: { reference?: string; paymentId?: string }) => {
    if (busy) return;
    setBusy(true); setError("");
    const r = await kioskFetch<{ reference: string | null }>("POST", "/kiosk/help", { reason, ...by });
    setBusy(false);
    if (r.ok) return setSent(r.data);
    setError(r.status === 0 ? "No internet right now. Please ask the staff." : r.status === 429 ? "Too many requests. Please ask the staff."
      : r.code === "UNKNOWN_REFERENCE" ? "We can't find that reference. Check it, or continue without one." : "That didn't work. Please ask the staff.");
  };
  const back = <button className="k-btn ghost" type="button" onClick={reason && !sent ? () => { setReason(null); setError(""); } : onClose}>{reason ? "Back" : "Close"}</button>;
  if (sent) return (
    <div className="k-panel k-help">
      <h1 className="k-title small">Thanks.</h1>
      <p className="k-text">The staff have been notified. Please show them this screen{sent.reference ? " or your reference" : ""}.</p>
      {sent.reference && <p className="k-ref big">Ref <b>{sent.reference}</b></p>}
      <button className="k-btn big" type="button" onClick={onClose}>Done</button>
    </div>
  );
  if (!reason) return (
    <div className="k-panel k-help">
      <h1 className="k-title small">What happened?</h1>
      <div className="k-actions col">{REASONS.map(([v, l]) => <button key={v} className="k-btn ghost big" type="button" onClick={() => setReason(v)}>{l}</button>)}</div>
      {back}
    </div>
  );
  return (
    <div className="k-panel k-help wide">
      <h1 className="k-title small">Which payment?</h1>
      {recent.length > 0 && <>
        <p className="k-text">Tap yours, or type your reference.</p>
        <div className="k-chips">{recent.map((p) => <button key={p.id} className="k-chip" type="button" disabled={busy} onClick={() => ask({ paymentId: p.id })}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(p.paidAt))} · {peso(p.amountCentavos, p.currency)}</button>)}</div>
      </>}
      <label className="k-voucher"><span className="k-cap">Reference</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} inputMode="none" autoComplete="off" spellCheck={false} maxLength={12} placeholder="XXXX-XXXX" /></label>
      <Keypad value={code} onChange={(v) => { setCode(v); setError(""); }} />
      {error && <p className="k-error" role="alert">{error}</p>}
      <div className="k-actions">
        <button className="k-btn" type="button" disabled={busy || code.replace(/[^0-9A-Z]/g, "").length < 8} onClick={() => ask({ reference: code })}>{busy ? "Sending…" : "Ask for help"}</button>
        <button className="k-btn ghost" type="button" disabled={busy} onClick={() => ask({})}>I don&apos;t have one</button>
        {back}
      </div>
    </div>
  );
}
