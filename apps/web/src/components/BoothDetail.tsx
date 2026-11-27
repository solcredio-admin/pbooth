"use client";
import Link from "next/link";
import { Ago } from "./Ago";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { useLiveBooths } from "@/lib/live";
import { DeleteZone } from "./DeleteZone";
import { Tabs } from "./Tabs";
import { Lockdown } from "./Lockdown";
import { AgentInstall, AgentRemove } from "./AgentInstall";
import { OpenKioskHere } from "./OpenKioskHere";
import { can, useMe } from "@/lib/roles";
import { BOOTH_LABEL, bytes, STATUS_LABEL } from "@/lib/format";
import type { BoothDto, CameraConfig, EventDto, HwStatus, StationDto } from "@/lib/types";

type BoothTab = "hardware" | "events" | "connect";
const BOOTH_TABS: { id: BoothTab; label: string }[] = [{ id: "hardware", label: "Hardware" }, { id: "events", label: "Events" }, { id: "connect", label: "Connect" }];

const hw = (s?: HwStatus) => (s ? `${s.name ?? "Unnamed"} · ${s.status}` : "Not reported yet");

export function BoothDetail({ initial, events, stations, origin }: { initial: BoothDto; events: EventDto[]; stations: StationDto[]; origin: string }) {
  const seed = useMemo(() => [initial], [initial]); // stable, or every render would reset the live data
  const { booths, connected } = useLiveBooths(seed, (b) => b.id === initial.id);
  const b = booths[0] ?? initial;
  const t = b.device?.telemetry ?? {};
  const may = can(useMe().role);
  // Nothing connected yet? Start where the setup happens; otherwise show the hardware.
  const [tab, setTab] = useState<BoothTab>(() => (initial.device || initial.kiosk ? "hardware" : "connect"));

  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href="/booths">← Booths</Link>
        <div>
          <div className="title-row">
            <h1>{b.name}</h1>
            <span className={`pill b-${b.status}`}>{BOOTH_LABEL[b.status]}</span>
            {b.simulated && <span className="sim-badge">Simulated</span>}
          </div>
          <div className="meta cap">
            <span>{b.code}</span>
            <span><span className={"live-dot" + (connected ? " on" : "")} aria-hidden="true" />{connected ? "Live" : "Connecting…"}</span>
            <span>Last seen <Ago iso={b.lastSeenAt} /></span>
          </div>
        </div>
        <div className="head-actions">
          {b.liveEvent && <Link className="btn go" href={`/events/${b.liveEvent.id}/booths`}>Live at {b.liveEvent.name}</Link>}
          {may.admin && <Link className="plain" href={`/settings?history=${b.id}`}>History</Link>}
          {may.openKiosk && <OpenKioskHere boothId={b.id} boothCode={b.code} className="btn ghost" />}
        </div>
      </section>
      <main className="detail with-tabs">
        <div className="detail-tabs"><Tabs label="Booth settings" tabs={BOOTH_TABS} value={tab} onChange={setTab} /></div>
        <div className="detail-main">
          <div className="tab-pane" hidden={tab !== "hardware"}><Hardware booth={b} readOnly={!may.manageBooths} /><Stations booth={b} all={stations} readOnly={!may.manageBooths} /></div>
          <div className="tab-pane" hidden={tab !== "events"}><Assignments booth={b} events={events} readOnly={!may.bookBooths} /></div>
          <div className="tab-pane" hidden={tab !== "connect"}>
            {may.manageBooths ? (
              <>
                <KioskPairing booth={b} origin={origin} />
                <Enroll booth={b} origin={origin} />
                <Lockdown booth={b} origin={origin} />
              </>
            ) : (
              <section className="host" aria-labelledby="open-here">
                <div className="host-head"><span className="cap">On the booth computer, signed in as you</span><h2 id="open-here">Open the kiosk</h2></div>
                <div className="panel"><div className="actions"><OpenKioskHere boothId={b.id} boothCode={b.code} /></div>
                  <p className="cap center">This browser becomes {b.name}&apos;s guest screen. Pairing another screen signs out the old one.</p></div>
              </section>
            )}
          </div>
        </div>
        <aside className="detail-side" aria-label="Booth status">
          <section className="side-card" aria-labelledby="side-conn">
            <h2 id="side-conn">Connection</h2>
            {!b.device && !b.kiosk ? (
              <div className="empty-state">
                <h3>{b.state === "REVOKED" ? "Access revoked." : "Nothing connected yet."}</h3>
                <p>For a webcam booth, pair its kiosk screen below. For a DSLR, also enroll the booth agent. Printers are set up under Stations.</p>
              </div>
            ) : !b.device ? (
              <>
                {b.lastError && <p className="booth-error" role="alert">{b.lastError}</p>}
                <dl className="kv">
                  <dt>Last seen</dt><dd><Ago iso={b.lastSeenAt} /></dd>
                  <dt>Kiosk</dt><dd>{b.kiosk!.online ? "On screen" : "Not open right now"} · {browserName(b.kiosk!.userAgent)}</dd>
                  <dt>Camera</dt><dd>{kioskCamera(b)}</dd>
                  <dt>Agent</dt><dd>Not installed (webcam booths don't need it)</dd>
                  {b.kiosk!.telemetry.queue && <><dt>Uploads</dt><dd>{b.kiosk!.telemetry.queue.pending} waiting on the booth{b.kiosk!.telemetry.queue.failed ? ` · ${b.kiosk!.telemetry.queue.failed} failed` : ""} · last sync {b.kiosk!.telemetry.queue.lastSyncAt ? <Ago iso={b.kiosk!.telemetry.queue.lastSyncAt} /> : "never"}</dd></>}
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
          </section>
          <section className="side-card" aria-labelledby="side-event">
            <h2 id="side-event">Event</h2>
            {b.liveEvent ? (
              <p><span className="live-dot on" aria-hidden="true" />Live at <Link href={`/events/${b.liveEvent.id}`}>{b.liveEvent.name}</Link></p>
            ) : b.nextEvent ? (
              <p>Next: <Link href={`/events/${b.nextEvent.id}`}>{b.nextEvent.name}</Link><br /><span className="cap">{new Date(b.nextEvent.startsAt).toLocaleString()}</span></p>
            ) : (
              <p className="cap">Not booked on an upcoming event.</p>
            )}
            <button type="button" className="plain cap" onClick={() => setTab("events")}>Manage bookings →</button>
          </section>
          {may.manageBooths && <Revoke booth={b} />}
          {may.manageBooths && <DeleteZone what="booth" name={b.name} path={`/booths/${b.id}/delete`} back="/booths"
            lost="Removes the booth, disconnects its computer and kiosk, and takes it off every event. Photos it already took stay with their events."
            blocked={b.liveEvent ? `This booth is serving “${b.liveEvent.name}” right now. Wrap up the event or take the booth off it first.` : undefined} />}
        </aside>
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
      <div className="host-head"><span className="cap">For DSLR cameras · one-time code, valid 30 minutes</span><h2 id="enr">{booth.device ? "Replace the agent computer" : "Booth agent"}</h2></div>
      <div className="panel enroll">
        {code ? (
          <>
            <p className="enroll-code" aria-label="Enrollment code">{code.code}</p>
            <p className="cap">Expires at {time(code.expiresAt)} · shown only once</p>
          </>
        ) : (
          // the expiry is shown in the viewer's local time, which the server can't know
          <p className="cap center" suppressHydrationWarning>{booth.enrollmentExpiresAt ? `A code is waiting (expires ${time(booth.enrollmentExpiresAt)}). A new one replaces it.` : booth.device ? "Enrolling another computer disconnects the current one." : "Codes are single-use and expire after 30 minutes."}</p>
        )}
        {error && <p className="cap err" role="alert">{error}</p>}
        <div className="actions"><button className="btn" type="button" onClick={generate} disabled={busy}>{busy ? "Generating…" : code ? "New code" : "Generate enrollment code"}</button><AgentRemove /></div>
        <AgentInstall origin={origin} code={code?.code ?? null} />
      </div>
    </section>
  );
}

function Hardware({ booth, readOnly }: { booth: BoothDto; readOnly: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = booth.device?.telemetry ?? {};
  // Cameras the booth reported: the agent's (DSLR/webcam) plus the kiosk browser's webcams.
  const cameras = [...(t.cameras ?? []), ...(booth.kiosk?.telemetry.cameras ?? [])];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "");
    const camera: CameraConfig = {
      provider: s("provider") as CameraConfig["provider"], deviceName: s("deviceName") || null,
      resolution: s("resolution") as CameraConfig["resolution"], orientation: s("orientation") as CameraConfig["orientation"],
      rotation: Number(s("rotation")) as CameraConfig["rotation"], mirrorPreview: f.get("mirrorPreview") === "on",
    };
    setBusy(true);
    const res = await send<BoothDto>("PATCH", `/booths/${booth.id}`, { name: s("name"), notes: s("notes"), camera });
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setStatus({ ok: true, text: booth.device ? "Saved. The booth applies it on its next check-in." : "Saved." });
    router.refresh();
  }

  // Unknown saved device names stay selectable even if the booth stopped reporting them.
  const camOptions = [...new Set([...cameras.map((c) => c.name), ...(booth.camera.deviceName ? [booth.camera.deviceName] : [])])];

  return (
    <section className="host" aria-labelledby="hw">
      <div className="host-head"><span className="cap">Sent to the booth as part of its config</span><h2 id="hw">Booth &amp; camera</h2></div>
      <div className="panel">
        <form className="form" onSubmit={save} key={booth.configVersion + booth.name}>
          <fieldset className="bare" disabled={readOnly}>
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
            <label className="field"><span>Booth display</span>
              <select name="orientation" defaultValue={booth.camera.orientation}><option value="landscape">Landscape screen (16:9)</option><option value="portrait">Portrait screen (9:16)</option></select>
              <span className="hint">The preview fills this screen and every photo is taken in this shape.</span>
            </label>
            <label className="field"><span>Camera rotation</span>
              <select name="rotation" defaultValue={String(booth.camera.rotation ?? 0)}>
                <option value="0">None</option><option value="90">90° clockwise</option><option value="180">180° (upside down)</option><option value="270">90° counter-clockwise</option>
              </select>
              <span className="hint">For a camera mounted sideways, e.g. turned to match a portrait screen.</span>
            </label>
            <label className="check"><input type="checkbox" name="mirrorPreview" defaultChecked={booth.camera.mirrorPreview} /><span>Mirror the live preview (photos are never mirrored)</span></label>
          </div>
          </fieldset>
          {readOnly ? <p className="cap center">Read-only: booth admins change hardware settings.</p> : (
            <div className="form-foot">
              <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

/** Where this booth prints: one station, a fixed list with backups, or several taking turns. */
function Stations({ booth, all, readOnly }: { booth: BoothDto; all: StationDto[]; readOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = booth.stations.map((s) => s.id);
  const rest = all.filter((s) => !ids.includes(s.id));
  const save = async (stationIds: string[], mode = booth.printMode) => {
    setBusy(true);
    const res = await send("PUT", `/booths/${booth.id}/stations`, { stationIds, mode });
    setBusy(false);
    setError(res.ok ? "" : res.message);
    router.refresh();
  };
  const swap = (i: number) => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; void save(n); };
  const rotate = booth.printMode === "ROTATE";

  return (
    <section className="host" aria-labelledby="stn">
      <div className="host-head"><span className="cap">The printers this booth may use</span><h2 id="stn">Stations</h2></div>
      <div className="panel">
        {booth.stations.length === 0 ? <p className="cap center">No station linked: this booth doesn&apos;t print.</p> : (
          <ul className="refunds">
            {booth.stations.map((s, i) => (
              <li key={s.id}>
                <div><b>{readOnly ? s.name : <Link href={`/stations/${s.id}`}>{s.name}</Link>}</b>
                  <div className="sub">{rotate || booth.stations.length === 1 ? "" : i === 0 ? "Main · " : "Backup · "}{!s.enabled ? "switched off" : s.ready ? "ready" : s.online ? "printer problem" : "offline"}</div></div>
                {!readOnly && <div className="refund-acts">
                  {i > 0 && !rotate && <button className="row-btn" type="button" disabled={busy} onClick={() => swap(i)} aria-label={`Move ${s.name} up`}>Move up</button>}
                  <button className="row-btn danger" type="button" disabled={busy} onClick={() => save(ids.filter((x) => x !== s.id))} aria-label={`Unlink ${s.name}`}>Unlink</button>
                </div>}
              </li>
            ))}
          </ul>
        )}
        {booth.stations.length > 1 && (
          <fieldset className="bare print-mode" aria-label="With several stations" disabled={readOnly || busy}>
            <label className="check"><input type="radio" name="printMode" checked={!rotate} onChange={() => save(ids, "FIXED")} /><span><b>Fixed list.</b> Always the main one. A backup prints only when the ones above it can&apos;t: off, out of paper, or stuck.</span></label>
            <label className="check"><input type="radio" name="printMode" checked={rotate} onChange={() => save(ids, "ROTATE")} /><span><b>Rotate.</b> They take turns. One that&apos;s off or busy is skipped.</span></label>
          </fieldset>
        )}
        {!readOnly && (rest.length ? (
          <label className="field"><span>Add a station</span>
            <select value="" disabled={busy} onChange={(e) => e.target.value && save([...ids, e.target.value])}>
              <option value="">Choose…</option>
              {rest.map((s) => <option key={s.id} value={s.id}>{s.name}{s.booths.length ? ` (also ${s.booths.map((b) => b.name).join(", ")})` : ""}</option>)}
            </select>
          </label>
        ) : all.length === 0 && <p className="cap center"><Link href="/stations">Add a station</Link> first.</p>)}
        {error && <p className="cap err" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function Assignments({ booth, events, readOnly }: { booth: BoothDto; events: EventDto[]; readOnly: boolean }) {
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
                {!readOnly && <button type="button" className="plain cap" disabled={busy} onClick={() => run("DELETE", `/events/${e.id}/booths/${booth.id}`)}>Remove</button>}
              </li>
            ))}
          </ul>
        ) : <p className="cap center">Not booked for any event.</p>}
        {!readOnly && booth.state !== "REVOKED" && choices.length > 0 && (
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
