"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { send } from "@/lib/client-api";
import type { EventConfig, EventDto } from "@/lib/types";
import { TemplatePreview } from "./TemplatePreview";
import { Tabs } from "./Tabs";
import { PALETTES, STYLE_LABEL, STYLE_OPTIONS, type StyleKey } from "@/lib/template/styles";

// The form's sections, one at a time. Every field stays in the form (hidden panes still submit).
type Tab = "event" | "selfservice" | "guest" | "design" | "prints";
const TABS: { id: Tab; label: string }[] = [
  { id: "event", label: "Event" }, { id: "selfservice", label: "Self-service" }, { id: "guest", label: "Guest screen" }, { id: "design", label: "Photo design" }, { id: "prints", label: "Prints & gallery" },
];
const TAB_OF: Record<string, Tab> = {
  name: "event", organizerName: "event", contactPhone: "event", contactEmail: "event", venueName: "event", venueAddress: "event", date: "event", startTime: "event", endTime: "event", timeZone: "event",
  welcomeTitle: "guest", welcomeMessage: "guest", primaryColor: "guest", accentColor: "guest", countdownSeconds: "guest", shotsPerSession: "guest", captureIntervalSeconds: "guest", previewSeconds: "guest",
  layout: "design", pattern: "design", frameStyle: "design", photoStyle: "design", fontStyle: "design", footerText: "design", showDate: "design", logo: "design", logoPosition: "design", logoSize: "design",
  printEnabled: "prints", printCopies: "prints", galleryEnabled: "prints", galleryRetentionDays: "prints", saveOriginals: "prints",
  kind: "event", priceCentavos: "selfservice", freeSessions: "selfservice", acceptVouchers: "selfservice", acceptQr: "selfservice", alertFrom: "selfservice", alertTo: "selfservice", partnerName: "selfservice", partnerSharePercent: "selfservice",
};

const DEFAULTS: EventConfig = {
  welcomeTitle: "Strike a pose", welcomeMessage: "Tap anywhere to start", primaryColor: "#0b0c0a", accentColor: "#c6f36b",
  countdownSeconds: 3, shotsPerSession: 3, captureIntervalSeconds: 3, previewSeconds: 3, layout: "landscape", pattern: "none", frameStyle: "line", photoStyle: "rounded", fontStyle: "serif", footerText: "", showDate: true, logo: null, logoPosition: "center", logoSize: 30, printEnabled: false, printCopies: 1, galleryEnabled: true, galleryRetentionDays: 30, saveOriginals: false,
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

/** The picked PNG, scaled down until it fits the server's limit; null if it can't be read. */
async function shrinkPng(file: File): Promise<string | null> {
  const bmp = file.type === "image/png" ? await createImageBitmap(file).catch(() => null) : null;
  if (!bmp) return null;
  for (let max = 1000; max >= 100; max = Math.round(max * 0.8)) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/png");
    if (url.length <= 200_000) return url;
  }
  return null;
}

// Create and edit share one form. Times are entered on the venue's clock; the API stores exact instants.
// lockMoney: cashiers run their events but the type, price and revenue share stay with the owner
export function EventForm({ event, canEdit = true, lockMoney = false }: { event?: EventDto; canEdit?: boolean; lockMoney?: boolean }) {
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
    pattern: cfg.pattern, frameStyle: cfg.frameStyle, photoStyle: cfg.photoStyle, fontStyle: cfg.fontStyle, logoPosition: cfg.logoPosition, logoSize: cfg.logoSize });
  const [logo, setLogo] = useState(cfg.logo);
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    const png = await shrinkPng(file);
    setLogo((old) => png ?? old);
    setErrors(({ logo: _, ...rest }) => (png ? rest : { ...rest, logo: "That file isn't a readable PNG" }));
  };
  const onFormChange = (e: React.FormEvent<HTMLFormElement>) => {
    const f = new FormData(e.currentTarget);
    setLook((old) => ({
      name: String(f.get("name") ?? ""), date: String(f.get("date") ?? ""), layout: (f.get("layout") as EventConfig["layout"]) ?? "landscape",
      shots: Math.min(4, Math.max(1, Number(f.get("shotsPerSession")) || 1)), footer: String(f.get("footerText") ?? ""), showDate: f.get("showDate") === "on",
      pattern: f.get("pattern") as EventConfig["pattern"], frameStyle: f.get("frameStyle") as EventConfig["frameStyle"],
      photoStyle: f.get("photoStyle") as EventConfig["photoStyle"], fontStyle: f.get("fontStyle") as EventConfig["fontStyle"],
      logoPosition: (f.get("logoPosition") as EventConfig["logoPosition"] | null) ?? old.logoPosition, logoSize: Number(f.get("logoSize")) || old.logoSize, // no fields without a logo
    }));
  };
  const previewDate = look.date ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${look.date}T12:00:00Z`)) : "Event date";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("event");
  const [kind, setKind] = useState<EventDto["kind"]>(event?.kind ?? "MANAGED");
  const tabs = TABS.filter((t) => t.id !== "selfservice" || kind === "SELF_SERVICE");
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
        captureIntervalSeconds: num("captureIntervalSeconds"), previewSeconds: num("previewSeconds"), layout: str("layout"), footerText: str("footerText"),
        pattern: str("pattern"), frameStyle: str("frameStyle"), photoStyle: str("photoStyle"), fontStyle: str("fontStyle"), showDate: f.get("showDate") === "on",
        ...(logo !== cfg.logo ? { logo } : {}), ...(logo ? { logoPosition: str("logoPosition"), logoSize: num("logoSize") } : {}),
        printEnabled: f.get("printEnabled") === "on", printCopies: num("printCopies"),
        galleryEnabled: f.get("galleryEnabled") === "on", galleryRetentionDays: num("galleryRetentionDays"),
        saveOriginals: f.get("saveOriginals") === "on",
      },
      ...(lockMoney ? {} : {
        kind: str("kind") || "MANAGED",
        ...(str("kind") === "SELF_SERVICE" ? {
          priceCentavos: Math.round(Number(f.get("price")) * 100), freeSessions: f.get("freeSessions") === "on",
          acceptVouchers: f.get("acceptVouchers") === "on", acceptQr: f.get("acceptQr") === "on",
          alertFrom: str("alertFrom") || null, alertTo: str("alertTo") || null,
          partnerName: str("partnerName"), partnerSharePercent: str("partnerSharePercent") === "" ? null : num("partnerSharePercent"),
        } : {}),
      }),
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
      <Tabs label="Event settings" tabs={tabs} value={tab} onChange={setTab} errors={errorTabs} />
      <fieldset disabled={readOnly || busy}>
        <div className="fields" hidden={tab !== "event"}>
          <Field name="kind" label="Event type" error={errors.kind} hint={kind === "SELF_SERVICE" ? "A booth left at a location (e.g. a café): guests pay or use a voucher" : "A dated event you run for a client"} wide>
            <select {...attrs("kind")} value={kind} disabled={lockMoney} onChange={(e) => setKind(e.target.value as EventDto["kind"])}>
              <option value="MANAGED">Managed event</option>
              <option value="SELF_SERVICE">Self-service location</option>
            </select>
          </Field>
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
          <Field name="previewSeconds" label="Photo preview (seconds)" error={errors.previewSeconds} hint="Each photo shows in a frame this long; guests can tap to retake">
            <input {...attrs("previewSeconds")} type="number" min={1} max={10} defaultValue={cfg.previewSeconds} />
          </Field>

        </div>
        <div className="fields" hidden={tab !== "design"}>
          <div className="wide design-row">
            <div className="design-fields">
              <Field name="layout" label="Layout" error={errors.layout} hint="Everything prints on 4×6 (4R) paper">
                <select {...attrs("layout")} defaultValue={cfg.layout}>
                  <option value="landscape">4R landscape (main print)</option>
                  {kind === "MANAGED" && <option value="strip">Photo strip 2×6, two per sheet to cut</option>}
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
                      ref={(el) => { if (el) el.style.background = `linear-gradient(135deg, ${pal.primaryColor} 50%, ${pal.accentColor} 50%)`; }} /* not style=: the CSP blocks inline styles in the page's HTML */ />
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
              <label className="check" hidden={kind === "SELF_SERVICE" || !!logo}><input type="checkbox" name="showDate" defaultChecked={cfg.showDate} /><span>Show the date</span></label>
              <Field name="logo" label="Logo (PNG)" error={errors.logo} hint={logo ? "Takes the date's place. A centred logo also replaces the footer text" : "Optional. A see-through background works best"}>
                <input {...attrs("logo")} type="file" accept="image/png" onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
              </Field>
              {logo && <button type="button" className="btn ghost" onClick={() => setLogo(null)}>Remove logo</button>}
              {logo && <>
                <Field name="logoPosition" label="Logo position" error={errors.logoPosition}>
                  <select {...attrs("logoPosition")} defaultValue={look.logoPosition}>
                    <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                  </select>
                </Field>
                <Field name="logoSize" label={`Logo size (${look.logoSize}% of the print's width)`} error={errors.logoSize} hint="Bigger than the footer, it overlaps the photos above">
                  <input {...attrs("logoSize")} type="range" min={10} max={100} defaultValue={look.logoSize} />
                </Field>
              </>}
            </div>
            <TemplatePreview logo={logo ? { src: logo, position: look.logoPosition, size: look.logoSize } : null} layout={kind === "SELF_SERVICE" && look.layout === "strip" ? "landscape" : look.layout} shots={look.shots} primaryColor={colors.primaryColor} accentColor={colors.accentColor}
              footer={look.footer || look.name || "Event name"} dateText={look.showDate && kind === "MANAGED" ? previewDate : null}
              pattern={look.pattern} frameStyle={look.frameStyle} photoStyle={look.photoStyle} fontStyle={look.fontStyle} />
          </div>

        </div>
        <div className="fields" hidden={tab !== "selfservice" || kind !== "SELF_SERVICE"}>
          <Field name="price" label="Price per session (₱)" error={errors.priceCentavos} hint="A paid session includes the prints">
            <input {...attrs("price")} type="number" min={0} step={1} defaultValue={(event?.priceCentavos ?? 15000) / 100} disabled={lockMoney} />
          </Field>
          <label className="check"><input type="checkbox" name="freeSessions" defaultChecked={event?.freeSessions ?? false} disabled={lockMoney} />
            <span>Free sessions: no payment, no prints, QR gallery only</span></label>
          <label className="check"><input type="checkbox" name="acceptVouchers" defaultChecked={event?.acceptVouchers ?? true} disabled={lockMoney} />
            <span>Guests can pay with a voucher from the counter</span></label>
          <label className="check"><input type="checkbox" name="acceptQr" defaultChecked={event?.acceptQr ?? true} disabled={lockMoney} />
            <span>Guests can scan to pay (PayMongo QR: GCash, Maya, banks)</span></label>
          {errors.acceptVouchers && <span className="err wide" role="alert">{errors.acceptVouchers}</span>}
          <Field name="alertFrom" label="Telegram alerts from" error={errors.alertFrom} hint="Set both to mute alerts while the booth is off on purpose">
            <input {...attrs("alertFrom")} type="time" defaultValue={event?.alertFrom ?? ""} disabled={lockMoney} />
          </Field>
          <Field name="alertTo" label="Telegram alerts until" error={errors.alertTo}>
            <input {...attrs("alertTo")} type="time" defaultValue={event?.alertTo ?? ""} disabled={lockMoney} />
          </Field>
          <Field name="partnerName" label="Revenue shared with" error={errors.partnerName} hint="The venue, e.g. the café. Leave empty if not shared">
            <input {...attrs("partnerName")} defaultValue={event?.partnerName ?? ""} maxLength={120} placeholder="Kape Tayo Café" disabled={lockMoney} />
          </Field>
          <Field name="partnerSharePercent" label="Their share (%)" error={errors.partnerSharePercent}>
            <input {...attrs("partnerSharePercent")} type="number" min={0} max={100} defaultValue={event?.partnerSharePercent ?? ""} placeholder="0" disabled={lockMoney} />
          </Field>
          <p className="hint wide cap">Turn on vouchers, QR or both. Make vouchers in the Vouchers tab. QR needs the PayMongo key on the server.{lockMoney ? " Only the owner changes the price and share." : ""}</p>
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
