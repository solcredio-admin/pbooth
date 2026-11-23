"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { send } from "@/lib/client-api";
import type { EventConfig, EventDto } from "@/lib/types";
import { TemplatePreview } from "./TemplatePreview";
import { Tabs } from "./Tabs";

// One-click colour pairs for the design (page colour, accent).
const PALETTES = [
  { name: "Midnight lime", primaryColor: "#0b0c0a", accentColor: "#c6f36b" },
  { name: "Classic white", primaryColor: "#f7f4ec", accentColor: "#1b1b1b" },
  { name: "Blush", primaryColor: "#f6dfe0", accentColor: "#b4475a" },
  { name: "Navy & gold", primaryColor: "#14213d", accentColor: "#e9c46a" },
  { name: "Sage", primaryColor: "#dfe7d6", accentColor: "#3f5f45" },
  { name: "Terracotta", primaryColor: "#f3e3d3", accentColor: "#c0593b" },
  { name: "Lavender", primaryColor: "#e7e1f5", accentColor: "#5b4b9a" },
  { name: "Black & white", primaryColor: "#111111", accentColor: "#f5f5f5" },
];
const STYLE_OPTIONS = {
  pattern: [["none", "Plain"], ["gradient", "Gradient"], ["dots", "Dots"], ["stripes", "Stripes"], ["grid", "Grid"], ["waves", "Waves"], ["confetti", "Confetti"]],
  frameStyle: [["line", "Thin line"], ["double", "Double line"], ["corners", "Corner marks"], ["none", "No frame"]],
  photoStyle: [["rounded", "Rounded"], ["square", "Square"], ["white", "White border"]],
  fontStyle: [["serif", "Elegant serif"], ["sans", "Bold sans"], ["mono", "Typewriter"]],
} as const;
type StyleKey = keyof typeof STYLE_OPTIONS;
const STYLE_LABEL: Record<StyleKey, string> = { pattern: "Background", frameStyle: "Frame", photoStyle: "Photo edges", fontStyle: "Footer type" };

// The form's sections, one at a time. Every field stays in the form (hidden panes still submit).
type Tab = "event" | "guest" | "design" | "prints";
const TABS: { id: Tab; label: string }[] = [
  { id: "event", label: "Event" }, { id: "guest", label: "Guest screen" }, { id: "design", label: "Photo design" }, { id: "prints", label: "Prints & gallery" },
];
const TAB_OF: Record<string, Tab> = {
  name: "event", organizerName: "event", contactPhone: "event", contactEmail: "event", venueName: "event", venueAddress: "event", date: "event", startTime: "event", endTime: "event", timeZone: "event",
  welcomeTitle: "guest", welcomeMessage: "guest", primaryColor: "guest", accentColor: "guest", countdownSeconds: "guest", shotsPerSession: "guest", captureIntervalSeconds: "guest",
  layout: "design", pattern: "design", frameStyle: "design", photoStyle: "design", fontStyle: "design", footerText: "design", showDate: "design",
  printEnabled: "prints", printCopies: "prints", galleryEnabled: "prints", galleryRetentionDays: "prints", saveOriginals: "prints",
};

const DEFAULTS: EventConfig = {
  welcomeTitle: "Strike a pose", welcomeMessage: "Tap anywhere to start", primaryColor: "#0b0c0a", accentColor: "#c6f36b",
  countdownSeconds: 3, shotsPerSession: 3, captureIntervalSeconds: 3, layout: "landscape", pattern: "none", frameStyle: "line", photoStyle: "rounded", fontStyle: "serif", footerText: "", showDate: true, printEnabled: false, printCopies: 1, galleryEnabled: true, galleryRetentionDays: 30, saveOriginals: false,
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
export function EventForm({ event, canEdit = true }: { event?: EventDto; canEdit?: boolean }) {
  const router = useRouter();
  const readOnly = event?.status === "ARCHIVED" || !canEdit;
  // Zone list and default come from the browser (the server runs in UTC), so they're filled in after mount.
  const [zones, setZones] = useState<{ list: string[]; mine: string } | null>(null);
  useEffect(() => setZones({ list: Intl.supportedValuesOf("timeZone"), mine: Intl.DateTimeFormat().resolvedOptions().timeZone }), []);
  const zoneList = zones ? [...new Set(["UTC", ...zones.list, ...(event ? [event.timeZone] : [])])] : [event?.timeZone ?? "UTC"];
  const cfg = { ...DEFAULTS, ...(event?.config ?? {}) };
  const [colors, setColors] = useState({ primaryColor: cfg.primaryColor, accentColor: cfg.accentColor });
  // What the live design preview shows; follows the form as it's edited.
  const [look, setLook] = useState({ name: event?.name ?? "", date: event?.local.date ?? "", layout: cfg.layout, shots: cfg.shotsPerSession, footer: cfg.footerText, showDate: cfg.showDate,
    pattern: cfg.pattern, frameStyle: cfg.frameStyle, photoStyle: cfg.photoStyle, fontStyle: cfg.fontStyle });
  const onFormChange = (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    setLook({
      name: String(f.get("name") ?? ""), date: String(f.get("date") ?? ""), layout: (f.get("layout") as EventConfig["layout"]) ?? "landscape",
      shots: Math.min(4, Math.max(1, Number(f.get("shotsPerSession")) || 1)), footer: String(f.get("footerText") ?? ""), showDate: f.get("showDate") === "on",
      pattern: f.get("pattern") as EventConfig["pattern"], frameStyle: f.get("frameStyle") as EventConfig["frameStyle"],
      photoStyle: f.get("photoStyle") as EventConfig["photoStyle"], fontStyle: f.get("fontStyle") as EventConfig["fontStyle"],
    });
  };
  const previewDate = look.date ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${look.date}T12:00:00Z`)) : "Event date";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("event");
  const errorTabs = [...new Set(Object.keys(errors).map((k) => TAB_OF[k]).filter(Boolean))];
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const attrs = (name: string) => ({ id: name, name, "aria-invalid": errors[name] ? true : undefined, "aria-describedby": errors[name] ? `${name}-err` : undefined });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "");
    const num = (k: string) => Number(f.get(k));
    const body = {
      name: str("name"), organizerName: str("organizerName"), contactPhone: str("contactPhone"), contactEmail: str("contactEmail"), venueName: str("venueName"), venueAddress: str("venueAddress"),
      date: str("date"), startTime: str("startTime"), endTime: str("endTime"), timeZone: str("timeZone"),
      config: {
        welcomeTitle: str("welcomeTitle"), welcomeMessage: str("welcomeMessage"),
        primaryColor: str("primaryColor"), accentColor: str("accentColor"),
        countdownSeconds: num("countdownSeconds"), shotsPerSession: num("shotsPerSession"),
        captureIntervalSeconds: num("captureIntervalSeconds"), layout: str("layout"), footerText: str("footerText"),
        pattern: str("pattern"), frameStyle: str("frameStyle"), photoStyle: str("photoStyle"), fontStyle: str("fontStyle"), showDate: f.get("showDate") === "on",
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
      const first = Object.keys(res.fields).map((k) => TAB_OF[k]).find(Boolean);
      if (first) setTab(first); // jump to the section with the problem
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
      <Tabs label="Event settings" tabs={TABS} value={tab} onChange={setTab} errors={errorTabs} />
      <fieldset disabled={readOnly || busy}>
        <div className="fields" hidden={tab !== "event"}>
          <Field name="name" label="Event name" error={errors.name} wide>
            <input {...attrs("name")} defaultValue={event?.name} required maxLength={120} autoFocus={!event} placeholder="Reyes Wedding" />
          </Field>
          <Field name="organizerName" label="Client / organizer" error={errors.organizerName}>
            <input {...attrs("organizerName")} defaultValue={event?.organizerName ?? ""} maxLength={120} />
          </Field>
          <Field name="contactPhone" label="Contact phone" error={errors.contactPhone} hint="Who to call on the day">
            <input {...attrs("contactPhone")} type="tel" inputMode="tel" autoComplete="off" defaultValue={event?.contactPhone ?? ""} maxLength={40} placeholder="+63 917 123 4567" />
          </Field>
          <Field name="contactEmail" label="Contact email" error={errors.contactEmail}>
            <input {...attrs("contactEmail")} type="email" inputMode="email" autoComplete="off" defaultValue={event?.contactEmail ?? ""} maxLength={254} placeholder="client@example.com" />
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

        </div>
        <div className="fields" hidden={tab !== "guest"}>
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

        </div>
        <div className="fields" hidden={tab !== "design"}>
          <div className="wide design-row">
            <div className="design-fields">
              <Field name="layout" label="Layout" error={errors.layout} hint="Everything prints on 4×6 (4R) paper">
                <select {...attrs("layout")} defaultValue={cfg.layout}>
                  <option value="landscape">4R landscape (main print)</option>
                  <option value="strip">Photo strip 2×6, two per sheet to cut</option>
                  <option value="grid">4R portrait grid</option>
                </select>
              </Field>
              <div className="field">
                <span>Colours</span>
                <div className="palettes" role="group" aria-label="Colour palettes">
                  {PALETTES.map((pal) => (
                    <button key={pal.name} type="button" className={"palette" + (colors.primaryColor === pal.primaryColor && colors.accentColor === pal.accentColor ? " on" : "")}
                      title={pal.name} aria-label={pal.name} disabled={readOnly}
                      onClick={() => setColors({ primaryColor: pal.primaryColor, accentColor: pal.accentColor })}
                      style={{ background: `linear-gradient(135deg, ${pal.primaryColor} 50%, ${pal.accentColor} 50%)` }} />
                  ))}
                </div>
                <span className="hint">Or pick any brand and accent colour above</span>
              </div>
              {(Object.keys(STYLE_OPTIONS) as StyleKey[]).map((k) => (
                <Field key={k} name={k} label={STYLE_LABEL[k]} error={errors[k]}>
                  <select {...attrs(k)} defaultValue={cfg[k]}>
                    {STYLE_OPTIONS[k].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </Field>
              ))}
              <Field name="footerText" label="Footer text" error={errors.footerText} hint="Leave empty to use the event name">
                <input {...attrs("footerText")} defaultValue={cfg.footerText} maxLength={60} placeholder={look.name || "Event name"} />
              </Field>
              <label className="check"><input type="checkbox" name="showDate" defaultChecked={cfg.showDate} /><span>Show the date</span></label>
            </div>
            <TemplatePreview layout={look.layout} shots={look.shots} primaryColor={colors.primaryColor} accentColor={colors.accentColor}
              footer={look.footer || look.name || "Event name"} dateText={look.showDate ? previewDate : null}
              pattern={look.pattern} frameStyle={look.frameStyle} photoStyle={look.photoStyle} fontStyle={look.fontStyle} />
          </div>

        </div>
        <div className="fields" hidden={tab !== "prints"}>
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
        {readOnly && <span className="cap">{canEdit ? "Archived events are read-only." : "Read-only: event admins change event settings."}</span>}
        <span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span>
      </div>
    </form>
  );
}
