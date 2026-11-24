"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useWebcam } from "@/lib/kiosk/camera";
import { useAgent, type AgentJob } from "@/lib/kiosk/agent";
import { kioskFetch, type KioskConfig } from "@/lib/kiosk/api";
import { cachedConfig, enqueuePhoto, kioskQueue, saveConfig } from "@/lib/offline/kiosk-sync";
import type { QueueStatus } from "@/lib/offline/queue";
import { composeTemplate, printCanvas, toJpeg } from "@/lib/template/compose";
import { plan, type Layout } from "@/lib/template/layout";
import { PALETTES, STYLE_LABEL, STYLE_OPTIONS, type Look, type StyleKey } from "@/lib/template/styles";
import { boothAspect, frameShot, snapshot } from "@/lib/kiosk/frame";
import { newGalleryToken } from "@/lib/kiosk/upload";
import { countdownBeep, readyDing, shutterSound, unlockSound, warningTick } from "@/lib/kiosk/sound";
import QRCode from "qrcode";

type Screen =
  | "loading" | "unpaired" | "wrong-booth" | "idle" | "agent" | "camera"
  | "welcome" | "pay" | "choose" | "ready" | "countdown" | "composing" | "review" | "done";

const INACTIVITY_MS = 60_000; // a guest who walks away mid-session
const DONE_RESET_S = 20;      // the thank-you screen clears itself
const DONE_RESET_QR_S = 35;   // longer when there's a QR code to scan
const REVIEW_AUTO_S = 60;     // the review screen saves by itself after this (a guest who walks away)
const CHOOSE_AUTO_S = 45;     // a self-service guest who doesn't choose gets the event's own shots and layout
const LAYOUT_NAME: Record<Layout, string> = { landscape: "4R landscape", strip: "Photo strips", grid: "4R portrait" };
// How to allow the camera, in the words of the browser the kiosk is running in.
function CameraHelp() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  // iPadOS Safari reports itself as a Mac; the touch points give it away
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  if (ios) return (
    <ol className="k-steps">
      <li>Tap <b>aA</b> (the page menu) in the address bar, then <b>Website Settings</b>.</li>
      <li>Set <b>Camera</b> to <b>Allow</b>. Or in the Settings app: <b>Apps → Safari → Camera → Allow</b>.</li>
      <li>Press <b>Try again</b>.</li>
    </ol>
  );
  if (safari) return (
    <ol className="k-steps">
      <li>In the menu bar, choose <b>Safari → Settings for this website</b>.</li>
      <li>Set <b>Camera</b> to <b>Allow</b>.</li>
      <li>Press <b>Try again</b>. Safari remembers the choice for next time.</li>
    </ol>
  );
  return (
    <ol className="k-steps">
      <li>Click the camera icon in the address bar (or the site settings icon next to the address).</li>
      <li>Set <b>Camera</b> to <b>Allow</b> for this site.</li>
      <li>Press <b>Try again</b>. The browser remembers the choice for next time.</li>
    </ol>
  );
}

const peso = (centavos: number, currency: string) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency, maximumFractionDigits: centavos % 100 ? 2 : 0 }).format(centavos / 100);

// One tap on the welcome screen is enough: instructions show this long, then the countdown starts.
const READY_SECONDS = 10;
const GUEST = new Set<Screen>(["pay", "choose", "ready", "countdown", "composing", "review", "done"]);

interface Shot { blob: Blob; url: string; printBlob?: Blob } // printBlob: the 4R sheet when it differs from the design

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
  const [peek, setPeek] = useState<{ url: string; n: number; last: boolean } | null>(null); // the photo just taken, shown before the next countdown
  const peekCtl = useRef<{ retake: () => void } | null>(null); // "retake this one" while it's showing
  const [readyLeft, setReadyLeft] = useState(READY_SECONDS); // instructions screen, then shooting starts by itself
  const [flash, setFlash] = useState(false);
  const [doneLeft, setDoneLeft] = useState(DONE_RESET_S);
  const [captureError, setCaptureError] = useState("");
  // Self-service guests choose their number of photos and layout after paying, and the design after
  // shooting; managed events use the event's own settings.
  const [choice, setChoice] = useState<{ shots: number; layout: Layout | null } | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const needed = choice?.layout ? choice.shots : guest?.shotsPerSession ?? 1;

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

  // The preview fills the whole screen in the screen's own shape, and every photo is captured in exactly
  // that shape, so what guests see is what's taken and it never changes between screens. A subtle guide
  // dims what the event design will crop away for the next shot (e.g. near-square strip slots).
  // Set through the CSSOM, since inline style attributes are blocked by the CSP.
  const portrait = config?.camera.orientation === "portrait";
  // The screen's own shape (an iPad is ~4:3, most monitors 16:9), so the preview and the photo fill
  // the whole screen; re-measured when the device rotates. The booth setting covers the first render.
  const [screenAspect, setScreenAspect] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => setScreenAspect(innerWidth / innerHeight);
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, []);
  const aspect = screenAspect ?? boothAspect(portrait);
  const rotation = config?.camera.rotation ?? 0;
  const shotIndex = Math.min(redo ?? shots.length, Math.max(0, needed - 1));
  const layout = (choice?.layout ?? guest?.template?.layout ?? "landscape") as Layout;
  const slot = live ? plan(layout, needed, config?.camera.orientation ?? "landscape").slots[shotIndex] : null;
  const slotAspect = slot ? slot.w / slot.h : aspect;
  // The preview frame shows a photo the way the print will crop it: its own slot's shape, centre-cropped
  // (as composeTemplate does), so guests can see if anyone is cut off and retake.
  const previewSeconds = guest?.previewSeconds ?? 3;
  const peekSlot = peek && live ? plan(layout, needed, config?.camera.orientation ?? "landscape").slots[peek.n - 1] : null;
  const peekCrop = peekSlot ? peekSlot.w / peekSlot.h : aspect;
  const [peekLeft, setPeekLeft] = useState(0); // the visible countdown while a photo is showing
  useEffect(() => {
    if (!peek) return;
    setPeekLeft(previewSeconds);
    const t = setInterval(() => setPeekLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [peek, previewSeconds]);
  const cropGuide = (screen === "ready" || screen === "countdown") && Math.abs(slotAspect / aspect - 1) > 0.03;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty("--k-aspect", aspect.toFixed(4));
    el.style.setProperty("--k-slot", slotAspect.toFixed(4));
    el.style.setProperty("--k-rot", `${rotation}deg`);
  }, [aspect, slotAspect, rotation]);

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
    setShots([]); setDesign(null); setRedo(null); setPeek(null); setCaptureError(""); setPrint(null); setQr(null); setSaving(null);
    setChoice(null); setLook(null);
    history.replaceState(null, "", `/kiosk/${boothCode}`);
    setScreen("loading"); // the resting-screen effect picks welcome / idle / camera
  }, [boothCode]);

  // Self-service and not free: the guest pays (a voucher for now) before the session starts.
  const selfService = config?.event?.selfService ?? null;
  const mustPay = !!selfService && !selfService.freeSessions;
  const payQrOn = !!selfService?.qr, payVoucherOn = selfService?.vouchers ?? true;

  const startSession = (paymentId?: string) => {
    const id = crypto.randomUUID();
    const galleryToken = newGalleryToken();
    session.current = { id, retakes: 0, finished: false, galleryToken };
    void kioskQueue().add("session-start", id, { id, startedAt: new Date().toISOString(), galleryToken, eventId: config?.event?.id, ...(paymentId ? { paymentId } : {}) });
    history.replaceState(null, "", `/kiosk/${boothCode}/session/${id}`);
    setChoice(null); setLook(null);
    setScreen(selfService ? "choose" : "ready");
  };
  const begin = () => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (mustPay) { setVoucher(""); setPayError(""); setPayQr(null); setScreen("pay"); return; }
    startSession();
  };
  const [voucher, setVoucher] = useState("");
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);
  const redeem = async () => {
    if (!voucher.trim() || paying) return;
    setPaying(true); setPayError("");
    const r = await kioskFetch<{ paymentId: string }>("POST", "/kiosk/redeem", { code: voucher });
    setPaying(false);
    if (r.ok) { startSession(r.data.paymentId); return; }
    setPayError(r.status === 0 ? "No internet right now. Vouchers need a connection; please try again in a moment."
      : r.status === 429 ? "Too many tries. Please ask the staff for help."
      : "That code isn't valid here, or it's already been used.");
  };

  // Scan to pay (PayMongo QR Ph): the server makes the QR and confirms with PayMongo; the booth just polls.
  const [payQr, setPayQr] = useState<{ paymentId: string; img: string; expiresAt: number } | null>(null);
  const [qrLeft, setQrLeft] = useState(0);
  const startQr = async () => {
    if (paying) return;
    setPaying(true); setPayError("");
    const r = await kioskFetch<{ paymentId: string; qr: string; expiresAt: string }>("POST", "/kiosk/payments/qr");
    setPaying(false);
    if (r.ok) { setPayQr({ paymentId: r.data.paymentId, img: r.data.qr, expiresAt: Date.parse(r.data.expiresAt) }); return; }
    setPayError(r.status === 0 ? "No internet right now. QR payment needs a connection; please try again in a moment."
      : "QR payment isn't available right now. Please use a voucher from the counter.");
  };
  useEffect(() => {
    if (screen !== "pay" || !payQr) return;
    let busy = false;
    const tick = async () => {
      const left = Math.max(0, Math.ceil((payQr.expiresAt - Date.now()) / 1000));
      setQrLeft(left);
      if (busy) return;
      busy = true;
      const r = await kioskFetch<{ status: string }>("GET", `/kiosk/payments/${payQr.paymentId}`);
      busy = false;
      const st = r.ok ? r.data.status : left > 0 ? "PENDING" : "EXPIRED";
      if (st === "PAID") { setPayQr(null); startSession(payQr.paymentId); }
      else if (st !== "PENDING") { setPayQr(null); setPayError(st === "EXPIRED" ? "That QR code expired. Tap Scan to pay for a new one." : "That payment didn't go through. Please ask the staff for help."); }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startSession is recreated each render; the QR is what matters
  }, [screen, payQr]);

  const shoot = useCallback(() => {
    setCaptureError("");
    setCount(guest?.countdownSeconds ?? 3);
    setScreen("countdown");
  }, [guest?.countdownSeconds]);

  // All photos inside the event template: what the guest approves (and, later, what gets printed).
  const compose = useCallback(async (list: Shot[], l: Look | null = look, quiet = false) => {
    if (!quiet) setScreen("composing");
    try {
      const bitmaps = await Promise.all(list.map((x) => createImageBitmap(x.blob)));
      const ev = config!.event!;
      const canvas = await composeTemplate(bitmaps, {
        layout,
        pattern: l?.pattern ?? guest?.template?.pattern, frameStyle: l?.frameStyle ?? guest?.template?.frameStyle,
        photoStyle: l?.photoStyle ?? guest?.template?.photoStyle, fontStyle: l?.fontStyle ?? guest?.template?.fontStyle,
        orientation: config!.camera.orientation,
        primaryColor: l?.primaryColor ?? guest?.primaryColor ?? "#0b0c0a",
        accentColor: l?.accentColor ?? guest?.accentColor ?? "#c6f36b",
        footer: guest?.template?.footerText || ev.name,
        dateText: guest?.template?.showDate === false ? null
          : new Intl.DateTimeFormat("en-US", { timeZone: ev.timeZone, month: "long", day: "numeric", year: "numeric" }).format(new Date(ev.startsAt)),
      });
      bitmaps.forEach((b) => b.close());
      const blob = await toJpeg(canvas);
      // the gallery gets the design; the printer gets the 4R sheet (a strip twice, to cut)
      const sheet = printCanvas(canvas, layout, list.length);
      const printBlob = sheet === canvas ? blob : await toJpeg(sheet);
      setDesign((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob), printBlob }; });
    } catch {
      setDesign(null); // the plain photos still show; the design is a bonus, never a blocker
    }
    if (!quiet) setScreen("review");
  }, [config, guest, layout, look]);

  // The countdown ticks once a second, then the shutter fires. In a multi-shot sequence the next
  // shorter countdown starts by itself; after the last photo the design is composed.
  useEffect(() => {
    if (screen !== "countdown") return;
    if (count > 0) {
      if (!peek) countdownBeep(count === 1);
      const t = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    shutterSound();
    setFlash(true);
    setTimeout(() => setFlash(false), 450);
    // More photos to come (counting this one): show it right away (a copy of the live frame at the
    // shutter) for the event's preview time. The next countdown waits for both the timer and the real
    // photo, so a slow camera can't cut the preview short or skip a shot. A tap on Retake redoes this
    // photo (once the real photo has arrived), then the sequence carries on.
    const n = redo !== null ? redo + 1 : shotsRef.current.length + 1;
    const more = (redo !== null ? shotsRef.current.length : shotsRef.current.length + 1) < needed;
    // a retake from the review screen gets the same preview, then goes back to the review
    const showPeek = more || redo !== null;
    let timerDone = false, captured = false, retake = false;
    let done: Shot[] = [];
    const next = () => {
      if (cancelled || !captured) return;
      if (retake) { peekCtl.current = null; setPeek(null); setRedo(n - 1); setCount(Math.max(1, guest?.countdownSeconds ?? 3)); return; }
      if (!timerDone) return;
      peekCtl.current = null; setPeek(null);
      if (more) setCount(guest?.captureIntervalSeconds ?? 3); else compose(done);
    };
    const startPeek = (url: string) => {
      setPeek({ url, n, last: !more });
      peekCtl.current = { retake: () => { retake = true; next(); } };
      setTimeout(() => { timerDone = true; next(); }, (guest?.previewSeconds ?? 3) * 1000);
    };
    let instant = false;
    if (showPeek) {
      const media = root.current?.querySelector<HTMLVideoElement | HTMLImageElement>(".k-view .k-media");
      const snap = media ? snapshot(media, rotation, aspect) : null;
      if (snap) { startPeek(snap); instant = true; }
    }
    (dslr ? agent.capture() : cam.capture())
      .then((raw) => frameShot(raw, rotation, aspect))
      .then((blob) => {
        if (cancelled) return;
        const shot = { blob, url: URL.createObjectURL(blob) };
        const list = [...shotsRef.current];
        if (redo !== null) { URL.revokeObjectURL(list[redo].url); list[redo] = shot; } else list.push(shot);
        setShots(list);
        setRedo(null);
        done = list;
        if (showPeek) {
          if (!instant) startPeek(shot.url); // couldn't copy the live frame: show the photo as it arrives
          captured = true;
          next();
        } else compose(list);
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
  // Choosing: a guest who walks away after paying still gets a session, with the event's own settings.
  const [chooseLeft, setChooseLeft] = useState(CHOOSE_AUTO_S);
  const choose = (shots: number, l: Layout | null) => {
    setChoice({ shots, layout: l });
    if (l) setScreen("ready");
  };
  useEffect(() => {
    if (screen !== "choose") return;
    setChooseLeft(CHOOSE_AUTO_S);
    const t = setInterval(() => setChooseLeft((n) => Math.max(0, n - 1)), 1000);
    const poke = () => setChooseLeft(CHOOSE_AUTO_S);
    window.addEventListener("pointerdown", poke);
    return () => { clearInterval(t); window.removeEventListener("pointerdown", poke); };
  }, [screen]);
  useEffect(() => {
    if (screen === "choose" && chooseLeft === 0) choose(guest?.shotsPerSession ?? 1, (guest?.template?.layout ?? "landscape") as Layout);
  }, [screen, chooseLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // The guest's design: starts from the event's, each tap redraws the print in place.
  const baseLook: Look = {
    primaryColor: guest?.primaryColor ?? "#0b0c0a", accentColor: guest?.accentColor ?? "#c6f36b",
    pattern: guest?.template?.pattern ?? "none", frameStyle: guest?.template?.frameStyle ?? "line",
    photoStyle: guest?.template?.photoStyle ?? "rounded", fontStyle: guest?.template?.fontStyle ?? "serif",
  };
  const restyle = (change: Partial<Look>) => {
    const next = { ...(look ?? baseLook), ...change };
    setLook(next);
    setReviewLeft(REVIEW_AUTO_S); // still choosing: don't save out from under them
    void compose(shotsRef.current, next, true);
  };

  // Nobody taps "Looks great"? Save after a minute anyway, so a guest who walks away still gets their photos.
  const [reviewLeft, setReviewLeft] = useState(REVIEW_AUTO_S);
  const approveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (screen !== "review") return;
    setReviewLeft(REVIEW_AUTO_S);
    const t = setInterval(() => setReviewLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [screen]);
  useEffect(() => { if (screen === "review" && reviewLeft === 0) approveRef.current(); }, [screen, reviewLeft]);
  useEffect(() => { if (screen === "review" && reviewLeft > 0 && reviewLeft <= 10) warningTick(); }, [screen, reviewLeft]);
  useEffect(() => { if (screen === "done" && doneLeft > 0 && doneLeft <= 5) warningTick(); }, [screen, doneLeft]);
  // photos saved: the QR link now has them, a soft ding (only when there's a QR to scan)
  const savedAll = screen === "done" && !!qr && !!saving && saving.total > 0 && saving.pending === 0;
  useEffect(() => { if (savedAll) readyDing(); }, [savedAll]);
  // Browsers allow sound only after a touch: the first tap anywhere turns it on.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockSound);
    return () => window.removeEventListener("pointerdown", unlockSound);
  }, []);

  const approve = () => {
    // free self-service sessions: photos on screen only (still saved for the owner), no QR, no print
    const sharing = !!config?.storage && guest?.galleryEnabled !== false && !selfService?.freeSessions;
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
    const image = design?.printBlob ?? design?.blob ?? shots[0]?.blob;
    if (!agent.available || !id || !image) { setPrint({ state: "unavailable" }); return; }
    setPrint({ state: "sending" });
    agent.print(id, image, guest?.printCopies ?? 1).then((j) => setPrint(printState(j))).catch((e) => setPrint({ state: "failed", message: (e as Error).message }));
  };
  approveRef.current = approve;

  // Follow the print while the thank-you screen is up. Depends only on the print's state, not on
  // every render (the screen re-renders each second for its countdown, which would reset the timer).
  const printing = screen === "done" && !!print && ["sending", "queued", "printing"].includes(print.state);
  useEffect(() => {
    const id = session.current?.id;
    if (!printing || !id) return;
    const t = setInterval(async () => { const j = await agentRef.current.job(id).catch(() => null); if (j) setPrint(printState(j)); }, 2000);
    return () => clearInterval(t);
  }, [printing]);

  // The instructions screen counts down and starts the photos itself (also after a failed capture).
  useEffect(() => {
    if (screen !== "ready") return;
    setReadyLeft(READY_SECONDS);
    const t = setInterval(() => setReadyLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [screen]);
  useEffect(() => { if (screen === "ready" && readyLeft <= 0) shoot(); }, [screen, readyLeft, shoot]);

  // Walked away? Abandon the session after a minute of no touches (never during the countdown).
  useEffect(() => {
    if (screen !== "ready" && screen !== "pay") return; // review saves itself after a minute instead
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

  const previewing = ["welcome", "pay", "choose", "ready", "countdown", "camera"].includes(screen) && camReady;
  const showVideo = !dslr && previewing;
  const showLive = dslr && previewing && !!agent.liveUrl;

  return (
    <div ref={root} className={`kiosk ks-${screen}`} onContextMenu={(e) => e.preventDefault()}>
      {showVideo && (
        <div className="k-frame">
          <div className="k-view">
            <video ref={cam.attach} className={"k-media" + (config?.camera.mirrorPreview ? " mirror" : "") + (rotation === 90 || rotation === 270 ? " sideways" : "")} muted playsInline autoPlay />
            {cropGuide && <div className="k-safe" aria-hidden="true" />}
          </div>
        </div>
      )}
      {showLive && (
        <div className="k-frame">
          <div className="k-view">
            {/* crossOrigin: the agent allows this site, so the frame at the shutter can be copied for the instant photo preview */}
            <img className={"k-media k-live" + (config?.camera.mirrorPreview ? " mirror" : "") + (rotation === 90 || rotation === 270 ? " sideways" : "")} src={agent.liveUrl!} crossOrigin="anonymous" alt="" />
            {cropGuide && <div className="k-safe" aria-hidden="true" />}
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
            <CameraHelp />
          ) : (
            <p className="k-text">{cam.state.error ?? "Plug in a USB webcam. This screen reconnects by itself."}</p>
          )}
          {!dslr && <button className="k-btn" type="button" onClick={() => cam.retry()}>Try again</button>}
        </Center>
      )}

      {screen === "welcome" && (
        <button type="button" className="k-tap" onClick={begin} aria-label="Start">
          <span className="k-glass">
            {config?.event?.name && <span className="k-event">{config.event.name}</span>}
            <span className="k-hero">{guest?.welcomeTitle ?? "Strike a pose"}</span>
            <span className="k-text">{guest?.welcomeMessage ?? "Tap anywhere to start"}</span>
          </span>
        </button>
      )}

      {screen === "pay" && selfService && (
        <form className="k-panel k-ready k-pay" onSubmit={(e) => { e.preventDefault(); void redeem(); }}>
          <p className="k-cap k-eyebrow">{config?.event?.name}</p>
          <h1 className="k-title">{peso(selfService.priceCentavos, selfService.currency)}</h1>
          {payQr ? (<>
            <p className="k-text"><b>Scan with GCash, Maya or your bank app.</b> Photos start as soon as it's paid.</p>
            <img className="k-payqr" src={payQr.img} alt="QR code to pay" />
            <p className="k-cap" aria-live="polite">Waiting for payment · {Math.floor(qrLeft / 60)}:{String(qrLeft % 60).padStart(2, "0")}</p>
            <div className="k-actions"><button className="k-btn ghost" type="button" onClick={() => reset("ABANDONED")}>Cancel</button></div>
          </>) : (<>
          <p className="k-text">{!payQrOn && !payVoucherOn ? <>Payment isn't set up at this booth yet. <b>Please ask the staff.</b></>
            : <>One session, printed. {payQrOn && payVoucherOn ? <><b>Scan to pay</b>, or enter a voucher code from the counter.</> : payQrOn ? <><b>Scan to pay</b> with GCash, Maya or your bank app.</> : <><b>Enter the voucher code</b> from the counter.</>}</>}</p>
          {payQrOn && <button className="k-btn big" type="button" onClick={() => void startQr()} disabled={paying}>Scan to pay</button>}
          {payVoucherOn && <label className="k-voucher">
            <span className="k-cap">Voucher code</span>
            <input value={voucher} onChange={(e) => setVoucher(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters"
              spellCheck={false} inputMode="none" maxLength={12} placeholder="XXXX-XXXX" autoFocus={!payQrOn} aria-invalid={payError ? true : undefined} />
          </label>}
          {payVoucherOn && <Keypad value={voucher} onChange={setVoucher} />}
          {payError && <p className="k-error" role="alert">{payError}</p>}
          <div className="k-actions">
            {payVoucherOn && <button className={payQrOn ? "k-btn" : "k-btn big"} type="submit" disabled={paying || voucher.trim().length < 4}>{paying ? "Checking…" : "Use voucher"}</button>}
            <button className="k-btn ghost" type="button" onClick={() => reset("ABANDONED")}>Cancel</button>
          </div>
          </>)}
        </form>
      )}
      {screen === "choose" && (
        <div className="k-panel k-choose">
          <p className="k-cap k-eyebrow">{config?.event?.name}</p>
          {!choice ? (<>
            <h1 className="k-title small">How many photos?</h1>
            <div className="k-choices">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" className="k-choice num" onClick={() => choose(n, n === 1 ? "landscape" : null)}>
                  <b>{n}</b><span>{n === 1 ? "photo" : "photos"}</span>
                </button>
              ))}
            </div>
          </>) : (<>
            <h1 className="k-title small">Pick a layout</h1>
            <div className="k-choices">
              {(["landscape", "strip", "grid"] as Layout[]).map((l) => (
                <button key={l} type="button" className="k-choice" onClick={() => choose(choice.shots, l)}>
                  <LayoutThumb layout={l} shots={choice.shots} orientation={config?.camera.orientation ?? "landscape"} />
                  <span>{LAYOUT_NAME[l]}</span>
                </button>
              ))}
            </div>
            <button type="button" className="k-btn ghost" onClick={() => setChoice(null)}>Back</button>
          </>)}
          <p className="k-cap">Starting with the usual settings in {chooseLeft}s</p>
        </div>
      )}
      {screen === "ready" && (
        // Priority, top to bottom: what's happening, how long until it starts, what to do, the fine print.
        <div className="k-panel k-ready">
          <p className="k-cap k-eyebrow">{needed > 1 ? `${needed} photos in a row` : "One photo"}</p>
          <h1 className="k-title">Get ready.</h1>
          <p className="k-ready-count" aria-live="polite"><span>Starting in</span> <b>{Math.max(0, readyLeft)}</b></p>
          <p className="k-text">
            {(guest?.countdownSeconds ?? 3) > 0 ? <>A <b>{guest?.countdownSeconds ?? 3}-second</b> countdown, then snap.</> : <>We snap right away.</>}
            {needed > 1 ? <> You&apos;ll see each photo for a moment before the next one. <b>Change poses between shots!</b></> : <> Look at the camera.</>}
          </p>
          {captureError && <p className="k-error" role="alert">{captureError}</p>}
          <div className="k-actions">
            <button className="k-btn big" type="button" onClick={shoot}>Start now</button>
            <button className="k-btn ghost" type="button" onClick={() => reset("ABANDONED")}>Cancel</button>
          </div>
          {config?.storage && (
            <p className="k-consent">By continuing, you agree that your photos are saved for {config.galleryRetentionDays} days and shared only with people who have your QR link.</p>
          )}
        </div>
      )}

      {screen === "countdown" && (
        <>
          {peek ? (
            <div className="k-peek" aria-live="polite">
              {/* the photo as taken, in a tilted instant-print frame over the live camera */}
              <button type="button" className="k-polaroid" onClick={() => peekCtl.current?.retake()} aria-label={`Photo ${peek.n} of ${needed}. Tap to retake`}
                ref={(el) => { el?.style.setProperty("--k-crop", peekCrop.toFixed(4)); el?.style.setProperty("--k-peek-s", `${previewSeconds}s`); }}>
                <img className={config?.camera.mirrorPreview ? "mirror" : undefined} src={peek.url} alt="" />
                <span className="k-polaroid-timer" key={peek.url} aria-hidden="true" />
                <span className="k-polaroid-cap">Photo {peek.n} of {needed}</span>
              </button>
              <div className="k-peek-bar">
                <p className="k-peek-hint" aria-live="off">{peekLeft > 0 ? <>{peek.last ? "Back to your photos in" : "Next photo in"} <b>{peekLeft}</b></> : peek.last ? "Back to your photos…" : "Next photo…"}</p>
                <button type="button" className="k-btn ghost" onClick={() => peekCtl.current?.retake()}>Retake</button>
              </div>
            </div>
          ) : (
            <p className="k-shot" aria-live="polite">{redo !== null ? `Retaking photo ${redo + 1}` : `Photo ${Math.min(shots.length + 1, needed)} of ${needed}`}</p>
          )}
          {!peek && count > 0 && <div className="k-count" key={`${shots.length}-${count}`} aria-live="assertive">{count}</div>}
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
            <div className="k-actions col">
              <button className="k-btn big" type="button" onClick={approve}>Looks great</button>
              <button className="k-btn ghost" type="button" onClick={retakeAll}>{shots.length > 1 ? "Retake all" : "Retake"}</button>
            </div>
            <p className="k-cap k-auto" aria-live="off">Saving automatically in <b>{reviewLeft}s</b></p>
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
            {selfService && design && (
              <div className="k-design-picks" aria-label="Design">
                <div className="k-swatches">
                  {PALETTES.map((p) => {
                    const cur = look ?? baseLook;
                    const on = cur.primaryColor === p.primaryColor && cur.accentColor === p.accentColor;
                    return (
                      <button key={p.name} type="button" className={"k-swatch" + (on ? " on" : "")} aria-label={p.name} aria-pressed={on}
                        ref={(el) => { el?.style.setProperty("--a", p.primaryColor); el?.style.setProperty("--b", p.accentColor); }}
                        onClick={() => restyle({ primaryColor: p.primaryColor, accentColor: p.accentColor })} />
                    );
                  })}
                </div>
                {(Object.keys(STYLE_OPTIONS) as StyleKey[]).map((k) => (
                  <div key={k} className="k-chips" role="group" aria-label={STYLE_LABEL[k]}>
                    <span className="k-cap">{STYLE_LABEL[k]}</span>
                    {STYLE_OPTIONS[k].map(([v, label]) => {
                      const on = (look ?? baseLook)[k] === v;
                      return <button key={v} type="button" className={"k-chip" + (on ? " on" : "")} aria-pressed={on} onClick={() => restyle({ [k]: v } as Partial<Look>)}>{label}</button>;
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {screen === "done" && (
        // the photo on the left, the QR big on the right (stacked on portrait screens)
        <div className={"k-done" + (qr ? " split" : "")}>
          <div className="k-done-photo">
            {design
              ? <img className="k-design final" src={design.url} alt="Your photos in the event design" />
              : <div className={`k-thumbs n${shots.length}`}>{shots.map((x, i) => <img key={x.url} src={x.url} alt={`Photo ${i + 1}`} />)}</div>}
          </div>
          <div className="k-done-side">
            <h1 className="k-title small">That's a wrap!</h1>
            {qr && (
              <div className="k-qr big">
                <img src={qr} alt="QR code to your photos" />
                <p className="k-qr-title">Scan for your photos</p>
                <p className="k-cap">{!saving ? "" : saving.pending === 0 ? "Saved. They'll be ready in a moment." : !online || queueStatus?.online === false ? "No internet right now. Your photos are safe here and upload automatically; the link fills in once they arrive." : `Saving ${saving.total - saving.pending} of ${saving.total}…`}</p>
              </div>
            )}
            {print && <p className={`k-print ${print.state}`} role="status">{PRINT_TEXT[print.state]}</p>}
            {!config?.storage && <p className="k-preview">Preview build: photos aren't saved yet.</p>}
            <div className="k-actions">
              <button className="k-btn big" type="button" onClick={() => reset("COMPLETED")}>Done</button>
            </div>
            <p className="k-cap">Clearing in {doneLeft}s</p>
          </div>
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

// On-screen QWERTY keyboard for voucher codes: touch-screen booths often have no keyboard. Codes skip
// I, L, O and U (they read as 1, 1, 0); those keys type what they mean, U is greyed out. The dash goes
// in by itself.
const KEY_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const KEY_MEANS: Record<string, string> = { O: "0", I: "1", L: "1" };
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const raw = value.replace(/[^0-9A-Z]/g, "");
  const set = (r: string) => onChange(r.length > 4 ? `${r.slice(0, 4)}-${r.slice(4, 8)}` : r);
  const full = raw.length >= 8;
  return (
    <div className="k-keypad" role="group" aria-label="Keyboard">
      {KEY_ROWS.map((row, n) => (
        <div className="k-keyrow" key={row}>
          {row.split("").map((k) => (
            <button key={k} type="button" className="k-key" disabled={full || k === "U"} onClick={() => set(raw + (KEY_MEANS[k] ?? k))}>{k}</button>
          ))}
          {n === 3 && <button type="button" className="k-key wide" onClick={() => set(raw.slice(0, -1))} aria-label="Delete">⌫</button>}
        </div>
      ))}
      <div className="k-keyrow"><button type="button" className="k-key space" onClick={() => set("")}>Clear</button></div>
    </div>
  );
}

/** A small picture of where the photos go on the print, for choosing a layout. */
function LayoutThumb({ layout, shots, orientation }: { layout: Layout; shots: number; orientation: "landscape" | "portrait" }) {
  const p = plan(layout, shots, orientation);
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  return (
    <span className="k-thumb" ref={(el) => el?.style.setProperty("--r", (p.width / p.height).toFixed(4))} aria-hidden="true">
      {p.slots.map((s, i) => (
        <i key={i} ref={(el) => { if (!el) return; el.style.left = pct(s.x, p.width); el.style.top = pct(s.y, p.height); el.style.width = pct(s.w, p.width); el.style.height = pct(s.h, p.height); }} />
      ))}
    </span>
  );
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
