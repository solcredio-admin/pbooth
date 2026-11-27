"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Ago } from "./Ago";
import { send } from "@/lib/client-api";
import type { PrintJobDto, StationDto } from "@/lib/types";

const STATUS: Record<PrintJobDto["status"], string> = { WAITING: "In line", CLAIMED: "Being fetched", PRINTING: "Printing", DONE: "Printed", FAILED: "Needs a look", EXPIRED: "Gave up waiting" };

/** Prints in line, printing, or needing a person: try again, or send to another station. */
export function PrintJobs({ jobs, stations, empty, readOnly = false }: { jobs: PrintJobDto[]; stations: StationDto[]; empty: string; readOnly?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<{ job: PrintJobDto; stationId: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "a deleted station";

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    const res = await send("POST", path, body);
    setBusy(false);
    router.refresh();
    setError(res.ok ? "" : res.message);
    return res.ok;
  };
  const move = (job: PrintJobDto, stationId: string) => {
    if (job.status === "PRINTING") { setPick({ job, stationId }); setError(""); dialog.current?.showModal(); } else void run(`/stations/jobs/${job.id}/move`, { stationId });
  };
  if (!jobs.length) return <p className="cap center">{empty}</p>;

  return (
    <>
      {error && !pick && <p className="cap err" role="alert">{error}</p>}
      <ul className="refunds">
        {jobs.map((j) => (
          <li key={j.id}>
            <div>
              <b>{STATUS[j.status]}{j.station && j.status !== "WAITING" ? ` · ${j.station.name}` : j.targetStationId ? ` · for ${name(j.targetStationId)}` : ""}</b>
              <div className="sub">{j.booth?.name ?? "Deleted booth"} · {j.event.name} · {j.copies > 1 ? `${j.copies} copies · ` : ""}<Ago iso={j.status === "DONE" ? j.doneAt : j.createdAt} /></div>
              {j.error && j.status !== "DONE" && <div className="sub err">{j.error}</div>}
            </div>
            {j.status !== "DONE" && !readOnly && (
              <div className="refund-acts">
                {j.status === "FAILED" && j.stationId && <button className="row-btn" type="button" disabled={busy} onClick={() => run(`/stations/jobs/${j.id}/retry`)}>Try again</button>}
                <span className="field move-to">
                  <select aria-label="Send to another station" value="" disabled={busy} onChange={(e) => e.target.value && move(j, e.target.value)}>
                    <option value="">Send to…</option>
                    {stations.filter((s) => s.enabled && (s.id !== j.stationId || j.status === "FAILED")).map((s) => <option key={s.id} value={s.id}>{s.name}{s.online ? "" : " (off)"}</option>)}
                  </select>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <dialog ref={dialog} className="setup confirm" aria-labelledby="move-title" onClose={() => setPick(null)}>
        {pick && (<>
          <span className="cap">{pick.job.station?.name} may be printing it</span>
          <h2 id="move-title">Send it to {name(pick.stationId)} anyway?</h2>
          <p>Look at {pick.job.station?.name ?? "the printer"} first. If it has printed, or still does, the guest&apos;s photo prints twice.</p>
          {error && <p className="cap err" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="button" className="btn warn" disabled={busy} onClick={async () => { if (await run(`/stations/jobs/${pick.job.id}/move`, { stationId: pick.stationId, confirm: true })) dialog.current?.close(); }}>Send it there</button>
          </div>
        </>)}
      </dialog>
    </>
  );
}
