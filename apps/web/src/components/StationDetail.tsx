"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AgentInstall, AgentRemove } from "./AgentInstall";
import { Ago } from "./Ago";
import { DeleteZone } from "./DeleteZone";
import { PrintJobs } from "./PrintJobs";
import { stationState } from "./StationsBoard";
import { send } from "@/lib/client-api";
import { can, useMe } from "@/lib/roles";
import type { PrintJobDto, StationDto } from "@/lib/types";

export function StationDetail({ station: s, all, jobs, origin }: { station: StationDto; all: StationDto[]; jobs: PrintJobDto[]; origin: string }) {
  const router = useRouter();
  const may = can(useMe().role);
  const readOnly = !may.manageBooths; // event and sales admins see stations, hardware admins run them
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => router.refresh(), 5000); return () => clearInterval(t); }, [router]);
  const st = stationState(s);
  const printers = [...new Set([...s.printers.map((p) => p.name), ...(s.printerName ? [s.printerName] : [])])];

  const run = async <T,>(method: string, path: string, body?: unknown) => {
    setBusy(true);
    const res = await send<T>(method, path, body);
    setBusy(false);
    setStatus(res.ok ? null : { ok: false, text: res.message });
    router.refresh();
    return res.ok ? res.data : null;
  };
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "");
    if (await run("PATCH", `/stations/${s.id}`, { name: v("name"), enabled: f.get("enabled") === "on", printerName: v("printerName") || null, paperSize: v("paperSize"), orientation: v("orientation") })) setStatus({ ok: true, text: "Saved. Used from the next print." });
  };

  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href="/stations">← Stations</Link>
        <div>
          <div className="title-row"><h1>{s.name}</h1><span className={`pill ${st.cls}`}>{st.text}</span>{s.computer?.simulated && <span className="sim-badge">Simulated</span>}</div>
          <div className="meta cap"><span>{s.code}</span><span>Last seen <Ago iso={s.lastPollAt} /></span></div>
        </div>
        {may.admin && <div className="head-actions"><Link className="plain" href={`/settings?history=${s.id}`}>History</Link></div>}
      </section>
      <main className="detail">
        <div className="detail-main">
          {s.lastError && s.online && <p className="booth-error" role="alert">{s.lastError}</p>}
          <section className="host" aria-labelledby="jobs">
            <div className="host-head"><span className="cap">At this station, or sent to it</span><h2 id="jobs">Prints</h2></div>
            <div className="panel"><PrintJobs jobs={jobs} stations={all} empty="Nothing here right now." readOnly={readOnly} /></div>
          </section>
          <section className="host" aria-labelledby="set">
            <div className="host-head"><span className="cap">Used for every booth that prints here</span><h2 id="set">Printer</h2></div>
            <div className="panel">
              <form className="form" onSubmit={save} inert={readOnly || undefined} key={`${s.name}${s.enabled}${s.printerName}${s.paperSize}${s.orientation}`}>
                <div className="fields">
                  <label className="field"><span>Station name</span><input name="name" defaultValue={s.name} maxLength={80} required /><span className="hint">Guests see it: &ldquo;Collect it at {s.name}&rdquo;.</span></label>
                  <label className="field"><span>Printer</span>
                    <select name="printerName" defaultValue={s.printerName ?? ""}>
                      <option value="">The computer&apos;s default</option>
                      {printers.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="hint">{s.printers.length ? "As its computer reports." : "Listed once its computer is connected."}</span>
                  </label>
                  <label className="field"><span>Paper</span>
                    <select name="paperSize" defaultValue={s.paperSize}><option value="4x6">4×6 in</option><option value="2x6">2×6 in strips</option><option value="5x7">5×7 in</option></select>
                    <span className="hint">Strip designs always print two per 4×6 sheet.</span>
                  </label>
                  <label className="field"><span>Print orientation</span>
                    <select name="orientation" defaultValue={s.orientation}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
                  </label>
                  <label className="check wide"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /><span>Takes prints (switch off to pause it: what it has finishes, the rest goes to other stations or waits)</span></label>
                </div>
                <div className="form-foot">{!readOnly && <button className="btn" type="submit" disabled={busy}>Save</button>}<span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span></div>
              </form>
            </div>
          </section>
          {!readOnly && <section className="host" aria-labelledby="pc">
            <div className="host-head"><span className="cap">The computer the printer is plugged into · one-time code, valid 30 minutes</span><h2 id="pc">{s.computer ? "Replace its computer" : "Connect its computer"}</h2></div>
            <div className="panel enroll">
              {code ? <><p className="enroll-code" aria-label="Station code">{code}</p><p className="cap">Valid 30 minutes · shown only once</p></> : <p className="cap center">A booth&apos;s own computer can be a station too: run the command there. Its booth keeps working.</p>}
              <div className="actions">
                <button className="btn" type="button" disabled={busy} onClick={async () => { const d = await run<{ code: string }>("POST", `/stations/${s.id}/enrollment-code`); if (d) setCode(d.code); }}>{code ? "New code" : "Generate station code"}</button>
                <AgentRemove />
              </div>
              <AgentInstall origin={origin} code={code} station />
            </div>
          </section>}
        </div>
        <aside className="detail-side" aria-label="Station status">
          <section className="side-card" aria-labelledby="side-pc">
            <h2 id="side-pc">Computer</h2>
            {s.computer ? (
              <>
                <dl className="kv">
                  <dt>Computer</dt><dd>{s.computer.hostname ?? "—"} · {s.computer.os ?? "unknown OS"}</dd>
                  <dt>Agent</dt><dd>{s.computer.agentVersion ?? "—"}</dd>
                  <dt>Connected</dt><dd><Ago iso={s.computer.enrolledAt} /></dd>
                </dl>
                {!s.lastPollAt && <p className="cap">This agent is too old to take prints from other booths. Install the latest one on that computer; its own booth keeps printing until then.</p>}
                {!readOnly && <button className="plain cap" type="button" disabled={busy} onClick={() => run("POST", `/stations/${s.id}/sign-out`)}>Sign this computer out</button>}
              </>
            ) : <p className="cap">Not connected yet.</p>}
          </section>
          <section className="side-card" aria-labelledby="side-booths">
            <h2 id="side-booths">Booths</h2>
            {s.booths.length ? <ul className="plain-list">{s.booths.map((b) => <li key={b.id}><Link href={`/booths/${b.id}`}>{b.name}</Link></li>)}</ul> : <p className="cap">No booth prints here yet. Link it on a booth&apos;s Hardware tab.</p>}
          </section>
          {!readOnly && <DeleteZone what="station" name={s.name} path={`/stations/${s.id}/delete`} back="/stations" lost="Removes the station and disconnects its computer. Booths that print here use their next station, if they have one." />}
        </aside>
      </main>
    </>
  );
}
