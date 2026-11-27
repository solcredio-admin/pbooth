"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Ago } from "./Ago";
import { PrintJobs } from "./PrintJobs";
import { send } from "@/lib/client-api";
import { can, useMe } from "@/lib/roles";
import type { PrintJobDto, StationDto } from "@/lib/types";

export function stationState(s: StationDto) {
  if (!s.enabled) return { cls: "b-UNREGISTERED", text: "Switched off" };
  if (!s.computer) return { cls: "b-UNREGISTERED", text: "No computer" };
  if (!s.online) return { cls: "b-OFFLINE", text: "Offline" };
  if (s.lastError) return { cls: "b-ERROR", text: "Printer problem" };
  return s.busy ? { cls: "b-ACTIVE", text: "Printing" } : { cls: "b-ONLINE", text: "Ready" };
}

export function StationsBoard({ stations, open, done }: { stations: StationDto[]; open: PrintJobDto[]; done: PrintJobDto[] }) {
  const router = useRouter();
  const readOnly = !can(useMe().role).manageBooths;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => router.refresh(), 5000); return () => clearInterval(t); }, [router]);
  const line = open.filter((j) => j.status === "WAITING" || j.status === "CLAIMED" || j.status === "PRINTING").reverse(); // oldest first, as they print
  const look = open.filter((j) => j.status === "FAILED" || j.status === "EXPIRED");

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) return setError("Give the station a name.");
    setBusy(true);
    const res = await send<StationDto>("POST", "/stations", { name });
    setBusy(false);
    if (!res.ok) return setError(res.fields.name ?? res.message);
    router.push(`/stations/${res.data.id}`);
  }

  return (
    <>
      <section className="hero compact"><span className="cap">{stations.filter((s) => s.ready).length} of {stations.length} ready · {line.length} in line</span><h1>Stations.</h1></section>
      <main>
        {look.length > 0 && (
          <section className="host" aria-labelledby="look">
            <div className="host-head"><span className="cap">Last 7 days</span><h2 id="look">Need a look</h2></div>
            <div className="panel"><PrintJobs jobs={look} stations={stations} empty="" readOnly={readOnly} /></div>
          </section>
        )}
        {stations.length > 0 && (
          <section className="host" aria-label="All stations">
            <div className="panel"><div className="table-wrap">
              <table className="table">
                <thead><tr><th>Station</th><th>Status</th><th className="hide-sm">Booths</th><th className="hide-sm">Last seen</th></tr></thead>
                <tbody>
                  {stations.map((s) => {
                    const st = stationState(s);
                    return (
                      <tr key={s.id}>
                        <td><Link className="row-link name" href={`/stations/${s.id}`}>{s.name}</Link><div className="sub">{s.code}{s.computer?.simulated && <span className="sim-badge">Simulated</span>}</div></td>
                        <td><span className={`pill ${st.cls}`}>{st.text}</span>{s.lastError && s.online && <div className="sub err-text">{s.lastError}</div>}</td>
                        <td className="hide-sm">{s.booths.map((b) => b.name).join(", ") || "None linked"}</td>
                        <td className="hide-sm"><Ago iso={s.lastPollAt} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div></div>
          </section>
        )}
        {stations.length > 0 && (
          <section className="host" aria-labelledby="line">
            <div className="host-head"><span className="cap">Oldest first, from every booth</span><h2 id="line">In line</h2></div>
            <div className="panel"><PrintJobs jobs={line} stations={stations} empty="Nothing in line." readOnly={readOnly} /></div>
          </section>
        )}
        {!readOnly && <section className="host" aria-labelledby="new-station">
          <div className="host-head"><span className="cap">A printer and the computer it&apos;s plugged into, shared by any booths</span><h2 id="new-station">{stations.length ? "Add a station" : "Your first station"}</h2></div>
          <div className="panel">
            <form className="inline-form" onSubmit={create}>
              <label className="field"><span>Station name</span><input name="name" maxLength={80} placeholder="Front desk, Back room…" aria-invalid={error ? true : undefined} /></label>
              <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add station"}</button>
            </form>
            <p className="cap">Guests see this name when it&apos;s time to collect their print.</p>
            {error && <p className="cap err" role="alert">{error}</p>}
          </div>
        </section>}
        {done.length > 0 && (
          <section className="host" aria-labelledby="done">
            <div className="host-head"><span className="cap">Last 100</span><h2 id="done">Printed</h2></div>
            <div className="panel"><PrintJobs jobs={done} stations={stations} empty="" readOnly={readOnly} /></div>
          </section>
        )}
      </main>
    </>
  );
}
