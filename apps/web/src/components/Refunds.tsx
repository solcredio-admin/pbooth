"use client";
import { useRefresh } from "@/lib/use-refresh";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { send } from "@/lib/client-api";
import { peso } from "@/lib/peso";
import { can, useMe } from "@/lib/roles";

export interface RefundRow {
  id: string; reason: "NO_SESSION" | "NO_PRINT" | "OTHER" | "SESSION_FAILED"; status: "OPEN" | "PROCESSING" | "REFUNDED" | "REPLACED" | "REJECTED"; note: string | null; link: string | null; providerRef: string | null; resolvedBy: string | null; createdAt: string; booth: string | null;
  payment: { reference: string; method: string; status: string; amountCentavos: number; currency: string } | null; event: { name: string; timeZone: string };
}
type Action = "PAYMONGO" | "MANUAL" | "VOUCHER" | "REJECT";
const REASON = { NO_SESSION: "Paid, but no session started", NO_PRINT: "Photos didn't print", OTHER: "Something else", SESSION_FAILED: "Paid, but no photos were made" };
const STATUS = { OPEN: "Waiting", PROCESSING: "Sent, not claimed yet", REFUNDED: "Refunded", REPLACED: "New voucher given", REJECTED: "Rejected" };
const ASK: Record<Action, (r: RefundRow) => { title: string; text: string; button: string }> = {
  PAYMONGO: (r) => ({ title: `Send back ${peso(r.payment!.amountCentavos, r.payment!.currency)}?`, text: "PayMongo sends the whole payment back. The guest gets it through a link you show them, valid for 3 days. This can't be undone.", button: "Refund through PayMongo" }),
  MANUAL: (r) => ({ title: `Paid back ${r.payment ? peso(r.payment.amountCentavos, r.payment.currency) : ""} by hand?`, text: "Only records it: give the guest their money first. The sale is subtracted from your reports.", button: "Mark as refunded" }),
  VOUCHER: () => ({ title: "Give a new voucher?", text: "One free session at this location, for 30 days. The code is shown once. The original sale stays in your reports.", button: "Make the voucher" }),
  REJECT: () => ({ title: "Reject this request?", text: "Nothing is refunded.", button: "Reject" }),
};

export function Refunds({ open, done }: { open: RefundRow[]; done: RefundRow[] }) {
  const me = useMe();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<{ r: RefundRow; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<{ code: string; event: string } | null>(null);
  useRefresh(20_000);
  const ask = (r: RefundRow, action: Action) => { setPick({ r, action }); setError(""); dialog.current?.showModal(); };
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    const res = await send<{ code?: string | null }>("POST", `/refunds/${pick.r.id}/resolve`, { action: pick.action });
    setBusy(false);
    router.refresh();
    if (!res.ok) return setError(res.message);
    if (res.data.code) setCode({ code: res.data.code, event: pick.r.event.name });
    dialog.current?.close();
  };
  const when = (r: RefundRow) => new Intl.DateTimeFormat("en-US", { timeZone: r.event.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(r.createdAt));
  const head = (r: RefundRow) => (
    <div>
      <b>{REASON[r.reason]}</b>
      <div className="sub">{when(r)} · {r.event.name}{r.booth ? ` · ${r.booth}` : ""}</div>
      <div className="sub">{r.payment ? <>Ref <code>{r.payment.reference}</code> · {peso(r.payment.amountCentavos, r.payment.currency)} by {r.payment.method === "QR" ? "QR" : "voucher"}</> : "No reference given"}</div>
      {r.note && <div className="sub err">{r.note}</div>}
    </div>
  );
  const text = pick && (pick.action === "PAYMONGO" && !pick.r.payment ? null : ASK[pick.action](pick.r));
  return (
    <>
      {code && (
        <section className="host" aria-labelledby="new-v">
          <div className="host-head"><span className="cap">Shown only now · {code.event}</span><h2 id="new-v">Replacement voucher</h2></div>
          <div className="panel enroll"><p className="enroll-code">{code.code}</p><div className="actions"><button className="btn" type="button" onClick={() => setCode(null)}>Done</button></div></div>
        </section>
      )}
      <section className="host" aria-labelledby="open">
        <div className="host-head"><span className="cap">Guests who asked for help, and paid sessions that failed</span><h2 id="open">Waiting</h2></div>
        <div className="panel">
          {open.length === 0 ? <p className="cap center">Nothing waiting.</p> : (
            <ul className="refunds">
              {open.map((r) => (
                <li key={r.id}>
                  {head(r)}
                  {r.status === "PROCESSING" ? (
                    <div className="refund-claim">
                      <span className="cap">{r.providerRef ? STATUS.PROCESSING : "No answer from PayMongo yet"}</span>
                      {r.link && <ClaimQr link={r.link} />}
                      {!r.providerRef && can(me.role).refundMoney && <button className="row-btn" type="button" onClick={() => ask(r, "PAYMONGO")}>Try again</button>}
                    </div>
                  ) : (
                    me.role === "SALES" ? <span className="cap">Waiting</span> : <div className="refund-acts">
                      {can(me.role).refundMoney && r.payment?.method === "QR" && <button className="row-btn" type="button" onClick={() => ask(r, "PAYMONGO")}>Refund by PayMongo</button>}
                      <button className="row-btn" type="button" onClick={() => ask(r, "VOUCHER")}>New voucher</button>
                      {can(me.role).refundMoney && r.payment && <button className="row-btn" type="button" onClick={() => ask(r, "MANUAL")}>Paid back by hand</button>}
                      <button className="row-btn danger" type="button" onClick={() => ask(r, "REJECT")}>Reject</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="host" aria-labelledby="done">
        <div className="host-head"><span className="cap">Last 200</span><h2 id="done">Handled</h2></div>
        <div className="panel">
          {done.length === 0 ? <p className="cap center">None yet.</p> : <ul className="refunds">{done.map((r) => <li key={r.id}>{head(r)}<span className="cap">{STATUS[r.status]}{r.resolvedBy ? ` · ${r.resolvedBy}` : ""}</span></li>)}</ul>}
        </div>
      </section>
      <dialog ref={dialog} className="setup confirm" aria-labelledby="ref-title">
        {text && pick && (<>
          <span className="cap">{pick.r.payment ? `Ref ${pick.r.payment.reference}` : pick.r.event.name}</span>
          <h2 id="ref-title">{text.title}</h2>
          <p>{text.text}</p>
          {error && <p className="cap err" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            <button type="button" className={pick.action === "VOUCHER" ? "btn" : "btn warn"} onClick={go} disabled={busy}>{busy ? "Working…" : text.button}</button>
          </div>
        </>)}
      </dialog>
    </>
  );
}

// The guest scans this at the counter to claim their money (pbooth has no way to message them).
function ClaimQr({ link }: { link: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { if (show) void QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setSrc); }, [link, show]);
  return <>{show && src ? <img className="claim-qr" src={src} alt="QR code the guest scans to claim the refund" /> : <button className="row-btn" type="button" onClick={() => setShow(true)}>Show QR to the guest</button>}</>;
}
