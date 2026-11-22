"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useWebcam } from "@/lib/kiosk/camera";
import { useAgent, type AgentJob } from "@/lib/kiosk/agent";
import { kioskFetch, type KioskConfig } from "@/lib/kiosk/api";
import { cachedConfig, enqueuePhoto, kioskQueue, saveConfig } from "@/lib/offline/kiosk-sync";
import type { QueueStatus } from "@/lib/offline/queue";
import { composeTemplate, toJpeg } from "@/lib/template/compose";
import { plan } from "@/lib/template/layout";
import { newGalleryToken } from "@/lib/kiosk/upload";
import QRCode from "qrcode";

type Screen =
  | "loading" | "unpaired" | "wrong-booth" | "idle" | "agent" | "camera"
  | "welcome" | "ready" | "countdown" | "composing" | "review" | "done";

const INACTIVITY_MS = 60_000; // a guest who walks away mid-session
const DONE_RESET_S = 20;      // the thank-you screen clears itself
const DONE_RESET_QR_S = 35;   // longer when there's a QR code to scan
const GUEST = new Set<Screen>(["ready", "countdown", "composing", "review", "done"]);

interface Shot { blob: Blob; url: string }

export function Kiosk({ boothCode }: { boothCode: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [pairedWith, setPairedWith] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const live = !!config?.event;
  const guest = config?.event?.guest;
  const cam = useWebcam(config?.camera ?? null, !!config && config.camera.provider === "webcam");
  // DSLR booths and printing go through the pbooth agent on this computer.
  const dslr = config?.camera.provider === "gphoto2";
  const printWanted = !!(config?.printer.enabled && guest?.printEnabled);
  const agent = useAgent(config?.booth.code, !!config && (dslr || !!config.printer.enabled));
  const camReady = dslr ? agent.available && agent.status?.camera?.status === "connected" : cam.state.status === "connected";
  const [liveSize, setLiveSize] = useState<string | null>(null); // DSLR live-view frame size
  const [print, setPrint] = useState<null | { state: "sending" | "queued" | "printing" | "done" | "failed" | "unavailable"; message?: string }>(null);

  // ---------- one guest's session ----------
  const session = useRef<{ id: string; retakes: number; finished: boolean; galleryToken: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ total: number; pending: number } | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [design, setDesign] = useState<Shot | null>(null); // the photos inside the event template
  const [redo, setRedo] = useState<number | null>(null);   // retaking just this photo
  const [count, setCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [doneLeft, setDoneLeft] = useState(DONE_RESET_S);
  const [captureError, setCaptureError] = useState("");
  const needed = guest?.shotsPerSession ?? 1;

  // ---------- config + heartbeat ----------
  const loadConfig = useCallback(async () => {
    const r = await kioskFetch<KioskConfig>("GET", `/kiosk/config?booth=${encodeURIComponent(boothCode)}`);
    if (r.ok) { setConfig(r.data); setOnline(true); void saveConfig(boothCode, r.data); return r.data; }
    if (r.status === 401) setScreen("unpaired");
    else if (r.status === 409 && r.code === "WRONG_BOOTH") { setPairedWith((r.details as { pairedWith?: string })?.pairedWith ?? null); setScreen("wrong-booth"); }
    else if (r.status === 0 || r.status >= 500) {
      // Offline: keep running on the last config this kiosk saw (in memory, or saved from before a reload).
      setOnline(false);
      const saved = await cachedConfig(boothCode);
      setConfig((current) => current ?? saved);
      return saved;
    }
    return null;
  }, [boothCode]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const camRef = useRef(cam);
  camRef.current = cam;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const queueRef = useRef<QueueStatus | null>(null);
  queueRef.current = queueStatus && { pending: queueStatus.pending, failed: queueStatus.failed, lastSyncAt: queueStatus.lastSyncAt, online: queueStatus.online };
  const beatRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!config) return;
    const beat = async () => {
      const c = camRef.current;
      const a = agentRef.current;
      const needsAgent = config.camera.provider === "gphoto2" || config.printer.enabled;
      const r = await kioskFetch<{ configVersion: string }>("POST", "/kiosk/heartbeat", {
        lastError: needsAgent && !a.available ? a.problem ?? "The pbooth agent isn't running on this computer"
          : config.camera.provider === "gphoto2" || c.state.status === "connected" || c.state.status === "idle" ? null : c.state.error ?? c.state.status,
        // a DSLR is reported by the agent itself; the kiosk reports only its webcam
        camera: config.camera.provider === "gphoto2" ? undefined : c.state.status === "idle" || c.state.status === "starting" ? undefined
          : { status: c.state.status === "insecure" ? "error" : c.state.status, name: c.state.name, resolution: c.state.resolution },
        cameras: c.cameras.slice(0, 20),
        queue: queueRef.current ?? undefined,
      });
      if (r.ok) { setOnline(true); if (r.data.configVersion !== config.version) loadConfig(); }
      else if (r.status === 401) setScreen("unpaired");
      else setOnline(false);
    };
    beatRef.current = beat;
    beat();
    const t = setInterval(beat, (config.heartbeatIntervalSeconds || 20) * 1000);
    return () => clearInterval(t);
  }, [config, loadConfig]);

  // A camera problem shows up in the admin right away, not at the next scheduled check-in.
  useEffect(() => {
    if (cam.state.status !== "starting") beatRef.current();
  }, [cam.state.status, agent.available]);

  // Which "resting" screen to show, given config and camera. Guests in the middle of a turn are never interrupted.
  useEffect(() => {
    if (!config || GUEST.has(screen) || screen === "unpaired" || screen === "wrong-booth") return;
    if (dslr && !agent.available) setScreen("agent");
    else if (!live) setScreen("idle");
    else if (!camReady) setScreen("camera");
    else setScreen("welcome");
  }, [config, live, camReady, dslr, agent.available, screen]);

  // What guests see is what ends up in the design: the preview box takes the shape of the template
  // slot this shot will fill, and the camera image is centre-cropped into it exactly like
  // composeTemplate does. Without a template slot, it's the camera's own frame (never cropped).
  // Set through the CSSOM, since inline style attributes are blocked by the CSP.
  const frameSize = dslr ? liveSize : cam.state.resolution;
  const shotIndex = Math.min(redo ?? shots.length, Math.max(0, needed - 1));
  const layout = (guest?.template?.layout ?? "strip") as "strip" | "grid";
  useEffect(() => {
    const slot = live ? plan(layout, needed, config?.camera.orientation ?? "landscape").slots[shotIndex] : null;
    const [w, h] = (frameSize ?? "16x9").split("x").map(Number);
    const aspect = slot ? slot.w / slot.h : w / h;
    root.current?.style.setProperty("--k-aspect", aspect.toFixed(4));
  }, [frameSize, live, layout, needed, shotIndex, config?.camera.orientation]);

  // Event colours, set through the CSSOM (inline style attributes are blocked by the CSP).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty("--k-bg", guest?.primaryColor ?? "#0b0c0a");
    el.style.setProperty("--k-accent", guest?.accentColor ?? "#c6f36b");
    el.style.setProperty("--k-ink", isLight(guest?.primaryColor ?? "#0b0c0a") ? "#0b0c0a" : "#f6f5f0");
  }, [guest?.primaryColor, guest?.accentColor]);

  // The outbox: show what's waiting, and follow this guest's photos on the thank-you screen.
  useEffect(() => {
    const q = kioskQueue();
    const refresh = async () => {
      const st = await q.status();
      setQueueStatus(st);
      const s = session.current;
      if (s) { const pending = await q.pendingPhotos(s.id); setSaving((v) => (v ? { ...v, pending } : v)); }
    };
    void refresh();
    const off = q.onChange(() => void refresh());
    const t = setInterval(refresh, 5000);
    return () => { off(); clearInterval(t); };
  }, []);

  // Offline helper: keeps a copy of this kiosk so it still opens if it's reloaded without internet.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/kiosk-sw.js", { scope: "/kiosk/" }).then(async () => {
      const reg = await navigator.serviceWorker.ready;
      const urls = [location.pathname, ...performance.getEntriesByType("resource").map((e) => e.name)]
        .filter((u) => u.startsWith("/") || u.startsWith(location.origin));
      reg.active?.postMessage({ type: "warm", urls, page: location.pathname });
    }).catch(() => undefined);
  }, []);

  // Keep the screen awake while the kiosk is open (where the browser supports it).
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const get = () => nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => undefined);
    get();
    const onVis = () => { if (document.visibilityState === "visible") get(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => undefined); };
  }, []);

  // ---------- guest flow ----------
  const shotsRef = useRef<Shot[]>([]);
  shotsRef.current = shots;
  const designRef = useRef<Shot | null>(null);
  designRef.current = design;

  const reset = useCallback((status: "COMPLETED" | "ABANDONED") => {
    const s = session.current;
    if (s && !s.finished) {
      s.finished = true;
      void kioskQueue().add("session-finish", s.id, { status, photoCount: shotsRef.current.length, retakeCount: s.retakes });
    }
    // Nothing of this guest stays on screen or in memory for the next one.
    shotsRef.current.forEach((x) => URL.revokeObjectURL(x.url));
    if (designRef.current) URL.revokeObjectURL(designRef.current.url);
    session.current = null;
    setShots([]); setDesign(null); setRedo(null); setCaptureError(""); setPrint(null); setQr(null); setSaving(null);
    history.replaceState(null, "", `/kiosk/${boothCode}`);
    setScreen("loading"); // the resting-screen effect picks welcome / idle / camera
  }, [boothCode]);

  const begin = () => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const id = crypto.randomUUID();
    const galleryToken = newGalleryToken();
    session.current = { id, retakes: 0, finished: false, galleryToken };
    void kioskQueue().add("session-start", id, { id, startedAt: new Date().toISOString(), galleryToken, eventId: config?.event?.id });
    history.replaceState(null, "", `/kiosk/${boothCode}/session/${id}`);
    setScreen("ready");
  };

  const shoot = useCallback(() => {
    setCaptureError("");
    setCount(guest?.countdownSeconds ?? 3);
    setScreen("countdown");
  }, [guest?.countdownSeconds]);

  // All photos inside the event template: what the guest approves (and, later, what gets printed).
  const compose = useCallback(async (list: Shot[]) => {
    setScreen("composing");
    try {
      const bitmaps = await Promise.all(list.map((x) => createImageBitmap(x.blob)));
      const ev = config!.event!;
      const canvas = await composeTemplate(bitmaps, {
        layout: (guest?.template?.layout ?? "strip") as "strip" | "grid",
        orientation: config!.camera.orientation,
        primaryColor: guest?.primaryColor ?? "#0b0c0a",
        accentColor: guest?.accentColor ?? "#c6f36b",
        footer: guest?.template?.footerText || ev.name,
        dateText: guest?.template?.showDate === false ? null
          : new Intl.DateTimeFormat("en-US", { timeZone: ev.timeZone, month: "long", day: "numeric", year: "numeric" }).format(new Date(ev.startsAt)),
      });
      bitmaps.forEach((b) => b.close());
      const blob = await toJpeg(canvas);
      setDesign((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; });
    } catch {
      setDesign(null); // the plain photos still show; the design is a bonus, never a blocker
    }
    setScreen("review");
  }, [config, guest]);

  // The countdown ticks once a second, then the shutter fires. In a multi-shot sequence the next
  // shorter countdown starts by itself; after the last photo the design is composed.
  useEffect(() => {
    if (screen !== "countdown") return;
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    setFlash(true);
    setTimeout(() => setFlash(false), 450);
    (dslr ? agent.capture() : cam.capture())
      .then((blob) => {
        if (cancelled) return;
        const shot = { blob, url: URL.createObjectURL(blob) };
        const list = [...shotsRef.current];
        if (redo !== null) { URL.revokeObjectURL(list[redo].url); list[redo] = shot; } else list.push(shot);
        setShots(list);
        setRedo(null);
        if (redo === null && list.length < needed) setCount(guest?.captureIntervalSeconds ?? 3);
        else compose(list);
      })
      .catch(() => { if (!cancelled) { setCaptureError("The camera didn't take that one. Let's try again."); setRedo(null); setScreen("ready"); } });
    return () => { cancelled = true; };
  }, [screen, count]); // eslint-disable-line react-hooks/exhaustive-deps

  const retakeAll = () => {
    shots.forEach((x) => URL.revokeObjectURL(x.url));
    setShots([]);
    if (session.current) session.current.retakes += shots.length;
    shoot();
  };
  const retakeOne = (i: number) => {
    setRedo(i);
    if (session.current) session.current.retakes++;
    shoot();
  };
  const approve = () => {
    const sharing = !!config?.storage && guest?.galleryEnabled !== false;
    setDoneLeft(sharing ? DONE_RESET_QR_S : DONE_RESET_S);
    setScreen("done");
    const s = session.current;
    if (s && config?.storage) {
      // Save in the background: the design always, each individual shot only if the event keeps
      // originals (otherwise storage holds just the finished photo). Uploads keep going after the
      // screen resets (the next guest never sees them), retrying through network blips.
      // (If the design couldn't be drawn, the first shot stands in for it so the guest still gets a photo.)
      const main = design?.blob ?? shots[0]?.blob;
      const files: [Blob, "DESIGN" | "ORIGINAL", number][] = [
        ...(main ? [[main, "DESIGN", 0] as [Blob, "DESIGN", number]] : []),
        ...(guest?.saveOriginals ? shots.map((x, i) => [x.blob, "ORIGINAL", i + 1] as [Blob, "ORIGINAL", number]) : []),
      ];
      // Into the durable outbox: delivered whenever the cloud is reachable, even after a reload.
      setSaving({ total: files.length, pending: files.length });
      void (async () => { for (const [blob, kind, index] of files) await enqueuePhoto(s.id, blob, kind, index); })();
      if (sharing) {
        QRCode.toDataURL(`${location.origin}/g/${s.galleryToken}`, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#0b0c0a", light: "#ffffff" } })
          .then(setQr).catch(() => setQr(null));
      }
    }
    if (!printWanted) return;
    // Printing never holds up the guest: the done screen just reports how it's going.
    const id = session.current?.id;
    const image = design?.blob ?? shots[0]?.blob;
    if (!agent.available || !id || !image) { setPrint({ state: "unavailable" }); return; }
    setPrint({ state: "sending" });
    agent.print(id, image, guest?.printCopies ?? 1).then((j) => setPrint(printState(j))).catch((e) => setPrint({ state: "failed", message: (e as Error).message }));
  };

  // Follow the print while the thank-you screen is up. Depends only on the print's state, not on
  // every render (the screen re-renders each second for its countdown, which would reset the timer).
  const printing = screen === "done" && !!print && ["sending", "queued", "printing"].includes(print.state);
  useEffect(() => {
    const id = session.current?.id;
    if (!printing || !id) return;
    const t = setInterval(async () => { const j = await agentRef.current.job(id).catch(() => null); if (j) setPrint(printState(j)); }, 2000);
    return () => clearInterval(t);
  }, [printing]);

  // Walked away? Abandon the session after a minute of no touches (never during the countdown).
  useEffect(() => {
    if (screen !== "ready" && screen !== "review") return;
    let t = setTimeout(() => reset("ABANDONED"), INACTIVITY_MS);
    const poke = () => { clearTimeout(t); t = setTimeout(() => reset("ABANDONED"), INACTIVITY_MS); };
    window.addEventListener("pointerdown", poke);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", poke); };
  }, [screen, reset]);

  useEffect(() => {
    if (screen !== "done") return;
    if (doneLeft <= 0) { reset("COMPLETED"); return; }
    const t = setTimeout(() => setDoneLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [screen, doneLeft, reset]);

  // ---------- pairing ----------
  const [pairError, setPairError] = useState("");
  const [pairing, setPairing] = useState(false);
  async function pair(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPairing(true);
    const r = await kioskFetch("POST", "/kiosk/pair", { boothCode, code: String(new FormData(e.currentTarget).get("code") ?? "") });
    setPairing(false);
    if (!r.ok) return setPairError(r.status === 429 ? "Too many tries. Wait 15 minutes." : r.status === 0 ? "Can't reach the server." : "That code didn't work. It may be used or expired.");
    setPairError("");
    setScreen("loading");
    loadConfig();
  }

  const previewing = ["welcome", "ready", "countdown", "camera"].includes(screen) && camReady;
  const soft = screen === "welcome"; // the welcome screen uses the camera as a blurred backdrop
  const showVideo = !dslr && previewing;
  const showLive = dslr && previewing && !!agent.liveUrl;
  const portrait = config?.camera.orientation === "portrait";

  return (
    <div ref={root} className={`kiosk ks-${screen}`} onContextMenu={(e) => e.preventDefault()}>
      {showVideo && (
        <div className={"k-frame" + (soft ? " soft" : "")}>
          <div className="k-view"><video ref={cam.attach} className={config?.camera.mirrorPreview ? "mirror" : undefined} muted playsInline autoPlay /></div>
        </div>
      )}
      {showLive && (
        <div className={"k-frame" + (soft ? " soft" : "")}>
          <div className="k-view">
            <img className={"k-live" + (config?.camera.mirrorPreview ? " mirror" : "")} src={agent.liveUrl!} alt=""
              onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setLiveSize(`${i.naturalWidth}x${i.naturalHeight}`); }} />
          </div>
        </div>
      )}
      {flash && <div className="k-flash" aria-hidden="true" />}
      {(!online || (queueStatus && (queueStatus.pending > 0 || queueStatus.failed > 0))) && !GUEST.has(screen) && (
        <div className="k-offline" role="status">
          {!online ? "Offline · guests can keep going" : "Syncing"}
          {queueStatus?.pending ? ` · ${queueStatus.pending} waiting` : ""}{queueStatus?.failed ? ` · ${queueStatus.failed} failed` : ""}
        </div>
      )}

      {screen === "loading" && <Center><p className="k-cap">Starting…</p></Center>}

      {screen === "unpaired" && (
        <Center>
          <p className="k-cap">Booth {boothCode}</p>
          <h1 className="k-title">Pair this screen.</h1>
          <p className="k-text">In the pbooth admin, open this booth and choose <b>Pair kiosk</b>. Enter the code shown there.</p>
          <form className="k-pair" onSubmit={pair}>
            <input name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" aria-label="Pairing code" required />
            <button className="k-btn" type="submit" disabled={pairing}>{pairing ? "Pairing…" : "Pair"}</button>
          </form>
          {pairError && <p className="k-error" role="alert">{pairError}</p>}
        </Center>
      )}

      {screen === "wrong-booth" && (
        <Center>
          <h1 className="k-title">Wrong booth.</h1>
          <p className="k-text">This screen is paired with <b>{pairedWith}</b>, not {boothCode}.</p>
          <div className="k-actions">
            {pairedWith && <a className="k-btn" href={`/kiosk/${pairedWith}`}>Open {pairedWith}</a>}
            <button className="k-btn ghost" type="button" onClick={() => setScreen("unpaired")}>Pair {boothCode} instead</button>
          </div>
        </Center>
      )}

      {screen === "agent" && (
        <Center>
          <p className="k-cap">{config?.booth.name}</p>
          <h1 className="k-title">Waiting for the agent.</h1>
          <p className="k-text">This booth uses a DSLR camera through the pbooth agent on this computer. {agent.problem ?? "Start it with: pbooth-agent run"}. This screen connects by itself once it's running.</p>
        </Center>
      )}

      {screen === "idle" && (
        <Center>
          <p className="k-cap">{config?.booth.name} · {config?.booth.code}</p>
          <h1 className="k-title">Ready when you are.</h1>
          <p className="k-text">No event is live on this booth. It starts automatically when one goes live.</p>
          <p className="k-cap">Camera: {dslr ? (agent.status?.camera ? camLabel(agent.status.camera) : "waiting for the agent") : camLabel(cam.state)}</p>
          {queueStatus && <p className="k-cap">Uploads: {queueStatus.pending} waiting{queueStatus.failed ? `, ${queueStatus.failed} failed` : ""} · last sync {queueStatus.lastSyncAt ? new Date(queueStatus.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "never"}</p>}
        </Center>
      )}

      {screen === "camera" && (
        <Center>
          <p className="k-cap">{config?.booth.name}</p>
          <h1 className="k-title">{!dslr && cam.state.status === "permission-denied" ? "Allow the camera." : !dslr && cam.state.status === "insecure" ? "Camera blocked." : "Finding the camera…"}</h1>
          {dslr ? (
            <p className="k-text">{agent.status?.camera?.error ?? "Turn the camera on and connect it by USB. The agent reconnects by itself."}</p>
          ) : cam.state.status === "permission-denied" ? (
            <ol className="k-steps">
              <li>Click the camera icon in the address bar (or the site settings icon next to the address).</li>
              <li>Set <b>Camera</b> to <b>Allow</b> for this site.</li>
              <li>Press <b>Try again</b>. Chrome remembers the choice for next time.</li>
            </ol>
          ) : (
            <p className="k-text">{cam.state.error ?? "Plug in a USB webcam. This screen reconnects by itself."}</p>
          )}
          {!dslr && <button className="k-btn" type="button" onClick={() => cam.retry()}>Try again</button>}
        </Center>
      )}

      {screen === "welcome" && (
        <button type="button" className="k-tap" onClick={begin} aria-label="Start">
          <span className="k-cap">{config?.event?.name}</span>
          <span className="k-hero">{guest?.welcomeTitle ?? "Strike a pose"}</span>
          <span className="k-text">{guest?.welcomeMessage ?? "Tap anywhere to start"}</span>
        </button>
      )}

      {screen === "ready" && (
        <div className="k-panel">
          <p className="k-cap">{needed > 1 ? `${needed} photos in a row` : "One photo"}</p>
          <h1 className="k-title">Get ready.</h1>
          <p className="k-text">
            {(guest?.countdownSeconds ?? 3) > 0 ? `We count down from ${guest?.countdownSeconds ?? 3}, then snap` : "We snap right away"}
            {needed > 1 ? `, then ${needed - 1} more, ${guest?.captureIntervalSeconds ?? 3} seconds apart. Change poses between shots!` : ". Look at the camera."}
          </p>
          {config?.storage && (
            <p className="k-consent">By continuing, you agree that your photos are saved for {config.galleryRetentionDays} days and shared only with people who have your QR link.</p>
          )}
          {captureError && <p className="k-error" role="alert">{captureError}</p>}
          <div className="k-actions">
            <button className="k-btn big" type="button" onClick={shoot}>Start</button>
            <button className="k-btn ghost" type="button" onClick={() => reset("ABANDONED")}>Cancel</button>
          </div>
        </div>
      )}

      {screen === "countdown" && (
        <>
          <p className="k-shot" aria-live="polite">{redo !== null ? `Retaking photo ${redo + 1}` : `Photo ${Math.min(shots.length + 1, needed)} of ${needed}`}</p>
          {count > 0 && <div className="k-count" key={`${shots.length}-${count}`} aria-live="assertive">{count}</div>}
        </>
      )}

      {screen === "composing" && <Center><p className="k-cap">Putting it together…</p></Center>}

      {screen === "review" && (
        <div className="k-review">
          {design
            ? <img className="k-design" src={design.url} alt="Your photos in the event design" />
            : <div className={`k-thumbs n${shots.length}`}>{shots.map((x, i) => <img key={x.url} src={x.url} alt={`Photo ${i + 1}`} />)}</div>}
          <div className="k-side">
            <h1 className="k-title small">Love it?</h1>
            {shots.length > 1 && (
              <>
                <p className="k-cap">Tap a photo to retake just that one</p>
                <div className="k-picks">
                  {shots.map((x, i) => (
                    <button key={x.url} type="button" className="k-pick" onClick={() => retakeOne(i)} aria-label={`Retake photo ${i + 1}`}>
                      <img src={x.url} alt="" /><span>{i + 1}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="k-actions col">
              <button className="k-btn big" type="button" onClick={approve}>Looks great</button>
              <button className="k-btn ghost" type="button" onClick={retakeAll}>{shots.length > 1 ? "Retake all" : "Retake"}</button>
            </div>
          </div>
        </div>
      )}

      {screen === "done" && (
        <div className="k-done">
          <h1 className="k-title">That's a wrap!</h1>
          {design
            ? <img className="k-design final" src={design.url} alt="Your photos in the event design" />
            : <div className={`k-thumbs n${shots.length}`}>{shots.map((x, i) => <img key={x.url} src={x.url} alt={`Photo ${i + 1}`} />)}</div>}
          {print && <p className={`k-print ${print.state}`} role="status">{PRINT_TEXT[print.state]}</p>}
          {qr && (
            <div className="k-qr">
              <img src={qr} alt="QR code to your photos" />
              <div>
                <p className="k-qr-title">Scan for your photos</p>
                <p className="k-cap">{!saving ? "" : saving.pending === 0 ? "Saved. They'll be ready in a moment." : !online || queueStatus?.online === false ? "No internet right now. Your photos are safe here and upload automatically; the link fills in once they arrive." : `Saving ${saving.total - saving.pending} of ${saving.total}…`}</p>
              </div>
            </div>
          )}
          {!config?.storage && <p className="k-preview">Preview build: photos aren't saved yet.</p>}
          <div className="k-actions">
            <button className="k-btn big" type="button" onClick={() => reset("COMPLETED")}>Done</button>
          </div>
          <p className="k-cap">Clearing in {doneLeft}s</p>
        </div>
      )}
    </div>
  );
}

const PRINT_TEXT = {
  sending: "Sending to the printer…",
  queued: "Your print is in line…",
  printing: "Printing your photos…",
  done: "Printed! Pick them up from the tray.",
  failed: "Printing didn't work. Please ask the attendant.",
  unavailable: "The printer isn't connected. Please ask the attendant.",
} as const;

function printState(j: AgentJob): { state: "queued" | "printing" | "done" | "failed"; message?: string } {
  if (j.status === "completed") return { state: "done" };
  if (j.status === "failed" || j.status === "cancelled") return { state: "failed", message: j.error ?? undefined };
  return { state: j.status === "printing" ? "printing" : "queued" };
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="k-center">{children}</div>;
}

function camLabel(s: { status: string; name?: string; resolution?: string; error?: string }) {
  if (s.status === "connected") return `${s.name ?? "connected"}${s.resolution ? ` · ${s.resolution}` : ""}`;
  return s.error ?? s.status;
}

function isLight(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
}
