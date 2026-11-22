"use client";
import Link from "next/link";
import { Ago } from "./Ago";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { useLiveBooths } from "@/lib/live";
import { BOOTH_LABEL, bytes, STATUS_LABEL } from "@/lib/format";
import type { BoothDto, CameraConfig, EventDto, HwStatus, PrinterConfig } from "@/lib/types";

const hw = (s?: HwStatus) => (s ? `${s.name ?? "Unnamed"} · ${s.status}` : "Not reported yet");

export function BoothDetail({ initial, events, origin }: { initial: BoothDto; events: EventDto[]; origin: string }) {
  const seed = useMemo(() => [initial], [initial]); // stable, or every render would reset the live data
  const { booths, connected } = useLiveBooths(seed, (b) => b.id === initial.id);
  const b = booths[0] ?? initial;
  const t = b.device?.telemetry ?? {};

  return (
    <>
      <section className="hero compact">
        <Link className="plain cap back" href="/booths">← Booths</Link>
        <h1>{b.name}</h1>
        <div className="meta cap">
          <span>{b.code}</span>
          <span><span className={"live-dot" + (connected ? " on" : "")} aria-hidden="true" />{connected ? "Live" : "Connecting…"}</span>
          {b.liveEvent && <span>At <Link href={`/events/${b.liveEvent.id}/booths`}>{b.liveEvent.name}</Link></span>}
        </div>
        <span className={`pill b-${b.status}`}>{BOOTH_LABEL[b.status]}</span>
        {b.simulated && <span className="sim-badge big">Simulated booth: not real hardware</span>}
      </section>
      <main className="narrow">
        <section className="host" aria-labelledby="conn">
          <div className="host-head"><span className="cap">What the booth reports each time it checks in</span><h2 id="conn">Connection</h2></div>
          <div className="panel">
            {!b.device && !b.kiosk ? (
              <div className="empty-state">
                <h3>{b.state === "REVOKED" ? "Access revoked." : "Nothing connected yet."}</h3>
                <p>For a webcam booth, pair its kiosk screen below. DSLR and printing need the booth agent (Phase 4).</p>
              </div>
            ) : !b.device ? (
              <>
                {b.lastError && <p className="booth-error" role="alert">{b.lastError}</p>}
                <dl className="kv">
                  <dt>Last seen</dt><dd><Ago iso={b.lastSeenAt} /></dd>
                  <dt>Kiosk</dt><dd>{b.kiosk!.online ? "On screen" : "Not open right now"} · {browserName(b.kiosk!.userAgent)}</dd>
                  <dt>Camera</dt><dd>{kioskCamera(b)}</dd>
                  <dt>Agent</dt><dd>Not installed (webcam booths don't need it)</dd>
                </dl>
              </>
            ) : (
              <>
                {b.device.lastError && <p className="booth-error" role="alert">{b.device.lastError}</p>}
                <dl className="kv">
                  <dt>Last seen</dt><dd><Ago iso={b.device.lastHeartbeatAt} /></dd>
                  <dt>Computer</dt><dd>{b.device.hostname ?? "—"} · {b.device.os ?? "unknown OS"}</dd>
                  <dt>Agent</dt><dd>{b.device.agentVersion ?? "—"}</dd>
                  <dt>Enrolled</dt><dd><Ago iso={b.device.enrolledAt} /></dd>
                  <dt>Camera</dt><dd>{b.kiosk && b.camera.provider === "webcam" ? kioskCamera(b) : <>{hw(t.camera)}{t.camera?.compatibility && <span className={`compat c-${t.camera.compatibility}`}>{t.camera.compatibility}</span>}</>}</dd>
                  <dt>Printer</dt><dd>{hw(t.printer)}</dd>
                  <dt>Kiosk</dt><dd>{!b.kiosk ? "Not paired" : b.kiosk.online ? "On screen" : "Not open right now"}</dd>
                  <dt>Storage</dt><dd>{t.storage ? `${bytes(t.storage.freeBytes)} free of ${bytes(t.storage.totalBytes)}` : "—"}</dd>
                  <dt>Pending</dt><dd>{t.pendingUploads ?? 0} uploads · {t.pendingPrints ?? 0} prints</dd>
                  {t.printJobs && <><dt>Prints</dt><dd>{t.printJobs.completedToday} printed today{t.printJobs.failed ? ` · ${t.printJobs.failed} failed` : ""}</dd></>}
                  <dt>Config</dt><dd>{b.configApplied ? `Up to date (${b.configVersion})` : `Waiting for the booth to apply ${b.configVersion}`}</dd>
                </dl>
              </>
            )}
          </div>
        </section>

        <KioskPairing booth={b} origin={origin} />
        <Enroll booth={b} origin={origin} />
        <Hardware booth={b} />
        <Assignments booth={b} events={events} />
        <Revoke booth={b} />
      </main>
    </>
  );
}

const browserName = (ua: string | null) =>
  !ua ? "unknown browser" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";

function kioskCamera(b: BoothDto) {
  const c = b.kiosk?.telemetry.camera;
  if (!c) return "Not reported yet";
  return `${c.name ?? "Webcam"} · ${c.status}${c.resolution ? ` · ${c.resolution}` : ""}`;
}

function KioskPairing({ booth, origin }: { booth: BoothDto; origin: string }) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `${origin}/kiosk/${booth.code}`;
  const run = async (path: string) => {
    setBusy(true);
    const res = await send<{ code: string; expiresAt: string }>("POST", path);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setError("");
    return res.data;
  };
  if (booth.state === "REVOKED") return null;

  return (
    <section className="host" aria-labelledby="kio">
      <div className="host-head"><span className="cap">The guest screen, in a fullscreen browser at the booth</span><h2 id="kio">Kiosk</h2></div>
      <div className="panel enroll">
        <p className="cap center">
          {booth.kiosk ? <>Paired {booth.kiosk.online ? "· on screen now" : <>· last seen <Ago iso={booth.kiosk.lastSeenAt} /></>}</> : "Not paired yet."}
        </p>
        {code ? (
          <>
            <p className="enroll-code" aria-label="Kiosk pairing code">{code.code}</p>
            <ol className="steps-text">
              <li>On the booth computer, open <b>{url}</b> in Chrome (HTTPS is required for the camera).</li>
              <li>Enter this code. It works once, for 30 minutes. Pairing a new screen signs out the old one.</li>
              <li>Allow the camera when Chrome asks. For a locked-down kiosk, start Chrome with:
                <pre className="code-line">google-chrome --kiosk --noerrdialogs {url}</pre>
              </li>
            </ol>
          </>
        ) : null}
        {error && <p className="cap err" role="alert">{error}</p>}
        <div className="actions">
          <button className="btn" type="button" disabled={busy} onClick={async () => { const d = await run(`/booths/${booth.id}/kiosk-code`); if (d) setCode(d); }}>
            {code ? "New code" : booth.kiosk ? "Pair a different screen" : "Pair kiosk"}
          </button>
          {booth.kiosk && <button className="btn ghost" type="button" disabled={busy} onClick={async () => { await run(`/booths/${booth.id}/kiosk/unpair`); setCode(null); router.refresh(); }}>Unpair</button>}
          <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Open kiosk</a>
        </div>
      </div>
    </section>
  );
}

function Enroll({ booth, origin }: { booth: BoothDto; origin: string }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    const res = await send<{ code: string; expiresAt: string }>("POST", `/booths/${booth.id}/enrollment-code`);
    setBusy(false);
    if (res.ok) { setCode(res.data); setError(""); } else setError(res.message);
  };
  const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  return (
    <section className="host" aria-labelledby="enr">
      <div className="host-head"><span className="cap">For DSLR cameras and printing · one-time code, valid 30 minutes</span><h2 id="enr">{booth.device ? "Replace the agent computer" : "Booth agent"}</h2></div>
      <div className="panel enroll">
        {code ? (
          <>
            <p className="enroll-code" aria-label="Enrollment code">{code.code}</p>
            <p className="cap">Expires at {time(code.expiresAt)} · shown only once</p>
            <ol className="steps-text">
              <li>On the booth computer, start the pbooth agent and enter this code. <span className="muted">(The agent ships in Phase 4.)</span></li>
              <li>To try it now without hardware, run the simulator from the repository:
                <pre className="code-line">node tools/simulate-booth.mjs --url {origin} --code {code.code}</pre>
              </li>
            </ol>
          </>
        ) : (
          // the expiry is shown in the viewer's local time, which the server can't know
          <p className="cap center" suppressHydrationWarning>{booth.enrollmentExpiresAt ? `A code is waiting (expires ${time(booth.enrollmentExpiresAt)}). A new one replaces it.` : booth.device ? "Enrolling another computer disconnects the current one." : "Codes are single-use and expire after 30 minutes."}</p>
        )}
        {error && <p className="cap err" role="alert">{error}</p>}
        <div className="actions"><button className="btn" type="button" onClick={generate} disabled={busy}>{busy ? "Generating…" : code ? "New code" : "Generate enrollment code"}</button></div>
      </div>
    </section>
  );
}

function Hardware({ booth }: { booth: BoothDto }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = booth.device?.telemetry ?? {};
  // Cameras the booth reported: the agent's (DSLR/webcam) plus the kiosk browser's webcams.
  const cameras = [...(t.cameras ?? []), ...(booth.kiosk?.telemetry.cameras ?? [])];
  const printers = t.printers ?? [];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    const camera: CameraConfig = {
      provider: s("provider") as CameraConfig["provider"], deviceName: s("deviceName") || null,
      resolution: s("resolution") as CameraConfig["resolution"], orientation: s("orientation") as CameraConfig["orientation"],
      mirrorPreview: f.get("mirrorPreview") === "on",
    };
    const printer: PrinterConfig = {
      enabled: f.get("printEnabled") === "on", printerName: s("printerName") || null,
      paperSize: s("paperSize") as PrinterConfig["paperSize"], orientation: s("printOrientation") as PrinterConfig["orientation"],
    };
    setBusy(true);
    const res = await send<BoothDto>("PATCH", `/booths/${booth.id}`, { name: s("name"), notes: s("notes"), camera, printer });
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setStatus({ ok: true, text: booth.device ? "Saved. The booth applies it on its next check-in." : "Saved." });
    router.refresh();
  }

  // Unknown saved device names stay selectable even if the booth stopped reporting them.
  const camOptions = [...new Set([...cameras.map((c) => c.name), ...(booth.camera.deviceName ? [booth.camera.deviceName] : [])])];
  const printOptions = [...new Set([...printers.map((p) => p.name), ...(booth.printer.printerName ? [booth.printer.printerName] : [])])];

  return (
    <section className="host" aria-labelledby="hw">
      <div className="host-head"><span className="cap">Sent to the booth as part of its config</span><h2 id="hw">Booth, camera &amp; printer</h2></div>
      <div className="panel">
        <form className="form" onSubmit={save} key={booth.configVersion + booth.name}>
          <div className="fields">
            <label className="field"><span>Name</span><input name="name" defaultValue={booth.name} maxLength={80} required /></label>
            <label className="field"><span>Notes</span><input name="notes" defaultValue={booth.notes ?? ""} maxLength={500} placeholder="Kit contents, quirks…" /></label>

            <h3>Camera</h3>
            <label className="field"><span>Type</span>
              <select name="provider" defaultValue={booth.camera.provider}>
                <option value="webcam">USB webcam (in the browser)</option>
                <option value="gphoto2">DSLR / mirrorless (via agent, Linux)</option>
              </select>
            </label>
            <label className="field"><span>Device</span>
              <select name="deviceName" defaultValue={booth.camera.deviceName ?? ""}>
                <option value="">First available</option>
                {camOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="hint">{cameras.length ? "As reported by the booth." : "The booth lists its cameras once it checks in."}</span>
            </label>
            <label className="field"><span>Resolution</span>
              <select name="resolution" defaultValue={booth.camera.resolution}>
                <option value="auto">Best available</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option>
              </select>
              <span className="hint">A request; the camera may not support it.</span>
            </label>
            <label className="field"><span>Orientation</span>
              <select name="orientation" defaultValue={booth.camera.orientation}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select>
            </label>
            <label className="check"><input type="checkbox" name="mirrorPreview" defaultChecked={booth.camera.mirrorPreview} /><span>Mirror the live preview (photos are never mirrored)</span></label>

            <h3>Printer</h3>
            <label className="check wide"><input type="checkbox" name="printEnabled" defaultChecked={booth.printer.enabled} /><span>This booth has a printer</span></label>
            <label className="field"><span>Printer</span>
              <select name="printerName" defaultValue={booth.printer.printerName ?? ""}>
                <option value="">System default</option>
                {printOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field"><span>Paper</span>
              <select name="paperSize" defaultValue={booth.printer.paperSize}><option value="4x6">4×6 in</option><option value="2x6">2×6 in strips</option><option value="5x7">5×7 in</option></select>
            </label>
            <label className="field"><span>Print orientation</span>
              <select name="printOrientation" defaultValue={booth.printer.orientation}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
            </label>
          </div>
          <div className="form-foot">
            <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span>
          </div>
        </form>
      </div>
    </section>
  );
}

function Assignments({ booth, events }: { booth: BoothDto; events: EventDto[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const assignedIds = new Set(booth.events.map((e) => e.id));
  const choices = events.filter((e) => !assignedIds.has(e.id) && (e.status === "DRAFT" || e.status === "SCHEDULED" || e.status === "ACTIVE"));

  const run = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    const res = await send(method, path, body);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setError("");
    router.refresh();
  };

  return (
    <section className="host" aria-labelledby="asg">
      <div className="host-head"><span className="cap">A booth serves one live event at a time</span><h2 id="asg">Events</h2></div>
      <div className="panel">
        {booth.events.length > 0 ? (
          <ul className="plain-list">
            {booth.events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}/booths`}>{e.name}</Link>
                <span className={`pill s-${e.status}`}>{STATUS_LABEL[e.status]}</span>
                <button type="button" className="plain cap" disabled={busy} onClick={() => run("DELETE", `/events/${e.id}/booths/${booth.id}`)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="cap center">Not booked for any event.</p>}
        {booth.state !== "REVOKED" && choices.length > 0 && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const id = String(new FormData(e.currentTarget).get("eventId") ?? ""); if (id) run("POST", `/events/${id}/booths`, { boothId: booth.id }); }}>
            <label className="field"><span>Book for</span>
              <select name="eventId" defaultValue="">
                <option value="" disabled>Choose an event…</option>
                {choices.map((e) => <option key={e.id} value={e.id}>{e.name} · {STATUS_LABEL[e.status]}</option>)}
              </select>
            </label>
            <button className="btn ghost" type="submit" disabled={busy}>Add</button>
          </form>
        )}
        {error && <p className="cap err" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function Revoke({ booth }: { booth: BoothDto }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (booth.state === "REVOKED") return null;
  const confirm = async () => {
    setBusy(true);
    const res = await send("POST", `/booths/${booth.id}/revoke`);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    dialog.current?.close();
    router.refresh();
  };
  return (
    <section className="host" aria-labelledby="rev">
      <div className="host-head"><span className="cap">If a booth computer is lost or replaced</span><h2 id="rev">Revoke access</h2></div>
      <div className="panel">
        <p className="cap center">The booth's device token stops working immediately. You can enroll a computer again later.</p>
        <div className="actions"><button className="btn warn" type="button" onClick={() => dialog.current?.showModal()}>Revoke</button></div>
        <dialog ref={dialog} className="setup confirm" aria-labelledby="rev-title">
          <span className="cap">{booth.name} · {booth.code}</span>
          <h2 id="rev-title">Revoke this booth?</h2>
          <p>Its computer is disconnected right away and can't upload or receive config until it's enrolled again with a new code.</p>
          {error && <p className="cap err" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            <button type="button" className="btn warn" onClick={confirm} disabled={busy} autoFocus>{busy ? "Revoking…" : "Revoke"}</button>
          </div>
        </dialog>
      </div>
    </section>
  );
}
