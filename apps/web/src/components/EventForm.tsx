"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { send } from "@/lib/client-api";
import type { EventConfig, EventDto } from "@/lib/types";
import { TemplatePreview } from "./TemplatePreview";

const DEFAULTS: EventConfig = {
  welcomeTitle: "Strike a pose", welcomeMessage: "Tap anywhere to start", primaryColor: "#0b0c0a", accentColor: "#c6f36b",
  countdownSeconds: 3, shotsPerSession: 3, captureIntervalSeconds: 3, layout: "strip", footerText: "", showDate: true, printEnabled: false, printCopies: 1, galleryEnabled: true, galleryRetentionDays: 30, saveOriginals: false,
};

function Field({ name, label, error, hint, wide, children }: { name: string; label: string; error?: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={"field" + (wide ? " wide" : "")} htmlFor={name}>
      <span>{label}</span>
      {children}
      {error ? <span className="err" id={`${name}-err`}>{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

// Create and edit share one form. Times are entered on the venue's clock; the API stores exact instants.
export function EventForm({ event }: { event?: EventDto }) {
  const router = useRouter();
  const readOnly = event?.status === "ARCHIVED";
  // Zone list and default come from the browser (the server runs in UTC), so they're filled in after mount.
  const [zones, setZones] = useState<{ list: string[]; mine: string } | null>(null);
  useEffect(() => setZones({ list: Intl.supportedValuesOf("timeZone"), mine: Intl.DateTimeFormat().resolvedOptions().timeZone }), []);
  const zoneList = zones ? [...new Set(["UTC", ...zones.list, ...(event ? [event.timeZone] : [])])] : [event?.timeZone ?? "UTC"];
  const cfg = { ...DEFAULTS, ...(event?.config ?? {}) };
  const [colors, setColors] = useState({ primaryColor: cfg.primaryColor, accentColor: cfg.accentColor });
  // What the live design preview shows; follows the form as it's edited.
  const [look, setLook] = useState({ name: event?.name ?? "", date: event?.local.date ?? "", layout: cfg.layout, shots: cfg.shotsPerSession, footer: cfg.footerText, showDate: cfg.showDate });
  const onFormChange = (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    setLook({
      name: String(f.get("name") ?? ""), date: String(f.get("date") ?? ""), layout: (f.get("layout") as "strip" | "grid") ?? "strip",
      shots: Math.min(4, Math.max(1, Number(f.get("shotsPerSession")) || 1)), footer: String(f.get("footerText") ?? ""), showDate: f.get("showDate") === "on",
    });
  };
  const previewDate = look.date ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${look.date}T12:00:00Z`)) : "Event date";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const attrs = (name: string) => ({ id: name, name, "aria-invalid": errors[name] ? true : undefined, "aria-describedby": errors[name] ? `${name}-err` : undefined });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "");
    const num = (k: string) => Number(f.get(k));
    const body = {
      name: str("name"), organizerName: str("organizerName"), venueName: str("venueName"), venueAddress: str("venueAddress"),
      date: str("date"), startTime: str("startTime"), endTime: str("endTime"), timeZone: str("timeZone"),
      config: {
        welcomeTitle: str("welcomeTitle"), welcomeMessage: str("welcomeMessage"),
        primaryColor: str("primaryColor"), accentColor: str("accentColor"),
        countdownSeconds: num("countdownSeconds"), shotsPerSession: num("shotsPerSession"),
        captureIntervalSeconds: num("captureIntervalSeconds"), layout: str("layout"), footerText: str("footerText"), showDate: f.get("showDate") === "on",
        printEnabled: f.get("printEnabled") === "on", printCopies: num("printCopies"),
        galleryEnabled: f.get("galleryEnabled") === "on", galleryRetentionDays: num("galleryRetentionDays"),
        saveOriginals: f.get("saveOriginals") === "on",
      },
    };
    setBusy(true);
    setStatus(null);
    const res = event ? await send<EventDto>("PATCH", `/events/${event.id}`, body) : await send<EventDto>("POST", "/events", body);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fields);
      setStatus({ ok: false, text: Object.keys(res.fields).length ? "Check the highlighted fields." : res.message });
      return;
    }
    setErrors({});
    if (event) {
      setStatus({ ok: true, text: "Saved." });
      router.refresh();
    } else {
      router.push(`/events/${res.data.id}`);
    }
  }

  return (
    <form className="form" onSubmit={submit} onChange={onFormChange} noValidate>
      <fieldset disabled={readOnly || busy}>
        <div className="fields">
          <h3>The event</h3>
          <Field name="name" label="Event name" error={errors.name} wide>
            <input {...attrs("name")} defaultValue={event?.name} required maxLength={120} autoFocus={!event} placeholder="Reyes Wedding" />
          </Field>
          <Field name="organizerName" label="Client / organizer" error={errors.organizerName}>
            <input {...attrs("organizerName")} defaultValue={event?.organizerName ?? ""} maxLength={120} />
          </Field>
          <Field name="venueName" label="Venue" error={errors.venueName}>
            <input {...attrs("venueName")} defaultValue={event?.venueName ?? ""} maxLength={160} />
          </Field>
          <Field name="venueAddress" label="Venue address" error={errors.venueAddress} wide>
            <input {...attrs("venueAddress")} defaultValue={event?.venueAddress ?? ""} maxLength={300} />
          </Field>
          <Field name="date" label="Date" error={errors.date}>
            <input {...attrs("date")} type="date" defaultValue={event?.local.date} required />
          </Field>
          <Field name="timeZone" label="Time zone" error={errors.timeZone} hint="The venue's time zone">
            <select {...attrs("timeZone")} key={zones ? "ready" : "init"} defaultValue={event?.timeZone ?? zones?.mine ?? "UTC"} required>
              {zoneList.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
            </select>
          </Field>
          <Field name="startTime" label="Starts" error={errors.startTime}>
            <input {...attrs("startTime")} type="time" defaultValue={event?.local.startTime ?? "18:00"} required />
          </Field>
          <Field name="endTime" label="Ends" error={errors.endTime} hint="Earlier than the start means past midnight">
            <input {...attrs("endTime")} type="time" defaultValue={event?.local.endTime ?? "23:00"} required />
          </Field>

          <h3>Guest experience</h3>
          <Field name="welcomeTitle" label="Welcome title" error={errors.welcomeTitle}>
            <input {...attrs("welcomeTitle")} defaultValue={cfg.welcomeTitle} maxLength={80} />
          </Field>
          <Field name="welcomeMessage" label="Welcome message" error={errors.welcomeMessage}>
            <input {...attrs("welcomeMessage")} defaultValue={cfg.welcomeMessage} maxLength={200} />
          </Field>
          {(["primaryColor", "accentColor"] as const).map((k) => (
            <Field key={k} name={k} label={k === "primaryColor" ? "Brand colour" : "Accent colour"} error={errors[k]}>
              <span className="color">
                <input {...attrs(k)} type="color" value={colors[k]} onChange={(e) => setColors({ ...colors, [k]: e.target.value })} />
                <code>{colors[k]}</code>
              </span>
            </Field>
          ))}
          <Field name="countdownSeconds" label="Countdown (seconds)" error={errors.countdownSeconds}>
            <input {...attrs("countdownSeconds")} type="number" min={0} max={10} defaultValue={cfg.countdownSeconds} />
          </Field>
          <Field name="shotsPerSession" label="Photos per session" error={errors.shotsPerSession} hint="1 to 4, taken in a row">
            <input {...attrs("shotsPerSession")} type="number" min={1} max={4} defaultValue={cfg.shotsPerSession} />
          </Field>
          <Field name="captureIntervalSeconds" label="Seconds between photos" error={errors.captureIntervalSeconds} hint="Time to change poses">
            <input {...attrs("captureIntervalSeconds")} type="number" min={1} max={10} defaultValue={cfg.captureIntervalSeconds} />
          </Field>

          <h3>Photo design</h3>
          <div className="wide design-row">
            <div className="design-fields">
              <Field name="layout" label="Layout" error={errors.layout} hint="One photo always prints as a framed 4×6">
                <select {...attrs("layout")} defaultValue={cfg.layout}>
                  <option value="strip">Photo strip (2×6)</option>
                  <option value="grid">Grid (4×6)</option>
                </select>
              </Field>
              <Field name="footerText" label="Footer text" error={errors.footerText} hint="Leave empty to use the event name">
                <input {...attrs("footerText")} defaultValue={cfg.footerText} maxLength={60} placeholder={look.name || "Event name"} />
              </Field>
              <label className="check"><input type="checkbox" name="showDate" defaultChecked={cfg.showDate} /><span>Show the date</span></label>
              <p className="hint cap">Uses the brand and accent colours above.</p>
            </div>
            <TemplatePreview layout={look.layout} shots={look.shots} primaryColor={colors.primaryColor} accentColor={colors.accentColor}
              footer={look.footer || look.name || "Event name"} dateText={look.showDate ? previewDate : null} />
          </div>

          <h3>Prints and gallery</h3>
          <label className="check"><input type="checkbox" name="printEnabled" defaultChecked={cfg.printEnabled} /><span>Print photos at the booth</span></label>
          <Field name="printCopies" label="Copies per session" error={errors.printCopies}>
            <input {...attrs("printCopies")} type="number" min={1} max={5} defaultValue={cfg.printCopies} />
          </Field>
          <label className="check"><input type="checkbox" name="galleryEnabled" defaultChecked={cfg.galleryEnabled} /><span>Guests get a QR gallery link</span></label>
          <Field name="galleryRetentionDays" label="Keep gallery photos (days)" error={errors.galleryRetentionDays}>
            <input {...attrs("galleryRetentionDays")} type="number" min={1} max={365} defaultValue={cfg.galleryRetentionDays} />
          </Field>
          <label className="check wide"><input type="checkbox" name="saveOriginals" defaultChecked={cfg.saveOriginals} /><span>Also save each individual photo (not just the finished design). Uses more storage; lets guests and you download every shot separately.</span></label>
          <p className="hint wide cap">These settings are saved with the event and used by the kiosk once booths are connected.</p>
        </div>
      </fieldset>
      <div className="form-foot">
        {!readOnly && <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : event ? "Save changes" : "Create event"}</button>}
        {readOnly && <span className="cap">Archived events are read-only.</span>}
        <span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span>
      </div>
    </form>
  );
}
