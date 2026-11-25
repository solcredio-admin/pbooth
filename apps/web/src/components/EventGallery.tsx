"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import QRCode from "qrcode";
import { send } from "@/lib/client-api";
import { commonAspect } from "@/lib/aspect";
import type { EventDto, EventPhotos } from "@/lib/types";

const Svg = ({ children }: { children: React.ReactNode }) => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const DownloadIcon = () => <Svg><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5L16.5 11" /><path d="M5 20h14" /></Svg>;
const PrinterIcon = () => <Svg><path d="M7 9V3.5h10V9" /><path d="M7 17.5H4.5v-7a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v7H17" /><path d="M7 14h10v6.5H7z" /></Svg>;
const GlobeIcon = () => <Svg><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5Z" /></Svg>;
const TrashIcon = () => <Svg><path d="M4.5 6.5h15" /><path d="M9 6.5V4h6v2.5" /><path d="m6.5 6.5 1 13.5h9l1-13.5" /><path d="M10 10.5v6" /><path d="M14 10.5v6" /></Svg>;
interface OnlineStation { id: string; name: string; ready: boolean; lastError: string | null }

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function EventGallery({ event, data, origin }: { event: EventDto; data: EventPhotos; origin: string }) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const confirmAll = useRef<HTMLDialogElement>(null);
  const reprintBox = useRef<HTMLDialogElement>(null);
  const [reprint, setReprint] = useState<{ id: string; sessionId: string; thumb: string | null } | null>(null);
  const [stations, setStations] = useState<OnlineStation[] | null>(null);
  const [printError, setPrintError] = useState("");
  const [sent, setSent] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const aspect = commonAspect(data.sessions.flatMap((s) => s.photos.filter((p) => p.kind === "DESIGN")));
  useEffect(() => {
    list.current?.style.setProperty("--tile", Math.max(0.6, aspect).toFixed(3));
    list.current?.style.setProperty("--col", aspect < 1 ? "140px" : "190px");
  }, [aspect, data.sessions.length]);
  const loadStations = async () => {
    const r = await send<{ items: OnlineStation[] }>("GET", `/events/${event.id}/stations`);
    if (r.ok) { setStations(r.data.items); setPrintError(""); } else { setStations([]); setPrintError(r.message); }
  };
  const askReprint = (sessionId: string, thumb: string | null) => {
    setReprint({ id: crypto.randomUUID(), sessionId, thumb }); setStations(null); setPrintError(""); setSent("");
    reprintBox.current?.showModal();
    void loadStations();
  };
  const sendPrint = async (st: OnlineStation) => {
    if (!reprint) return;
    setBusy(true);
    const r = await send("POST", `/events/${event.id}/sessions/${reprint.sessionId}/reprint`, { id: reprint.id, stationId: st.id });
    setBusy(false);
    if (r.ok) setSent(st.name); else { setPrintError(r.message); void loadStations(); }
  };
  const link = data.eventGalleryToken ? `${origin}/g/${data.eventGalleryToken}` : null;
  const c = data.counts;
  const ready = c.PROCESSED ?? 0, waiting = (c.PENDING ?? 0) + (c.UPLOADED ?? 0) + (c.PROCESSING ?? 0), failed = c.FAILED ?? 0;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  useEffect(() => {
    if (!link) { setQr(null); return; }
    QRCode.toDataURL(link, { margin: 1, width: 280 }).then(setQr).catch(() => setQr(null));
  }, [link]);

  const run = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    const r = await send(method, path, body);
    setBusy(false);
    if (!r.ok) { setError(r.message); return false; }
    setError("");
    router.refresh();
    return true;
  };

  return (
    <>
      <section className="detail-head">
        <Link className="plain cap back" href={`/events/${event.id}`}>← {event.name}</Link>
        <div>
          <div className="title-row"><h1>Gallery.</h1></div>
          <div className="meta cap"><span>Photos, guest links and export</span></div>
        </div>
        <div className="cap answer head-summary" role="status">
          <span className="free">{ready} photos ready</span>{waiting ? ` · ${waiting} on the way` : ""}{failed ? <> · <span className="taken">{failed} failed</span></> : ""}
        </div>
      </section>
      <main className="detail">
        <div className="detail-main">
        {!data.storageEnabled && (
          <p className="notice cap">Photo storage isn&apos;t set up yet, so photos aren&apos;t being saved. See <Link href="/settings">Settings → Storage</Link>.</p>
        )}
        {error && <p className="notice cap" role="alert">{error}</p>}
        <section className="host" aria-labelledby="sess">
          <div className="host-head"><span className="cap">{data.total} guest sessions with photos</span><h2 id="sess">Sessions</h2></div>
          <div className="panel">
            {data.sessions.length === 0 ? <p className="cap center">No photos yet.</p> : (
              <ul className="sessions" ref={list}>
                {data.sessions.map((s) => {
                  const design = s.photos.find((p) => p.kind === "DESIGN") ?? s.photos[0];
                  const shots = s.photos.filter((p) => p !== design);
                  const thumb = (p: typeof design, big: boolean) => p.thumbUrl
                    ? <img src={p.thumbUrl} alt={p.kind === "DESIGN" ? "Design" : `Photo ${p.index}`} loading="lazy" />
                    : <span className={`thumb-status s-${p.status}${big ? " big" : ""}`} title={p.error ?? undefined}>{p.status.toLowerCase()}</span>;
                  const when = time(s.startedAt, event.timeZone);
                  return (
                    <li key={s.id}>
                      {design && <div className="session-main">{thumb(design, true)}<span className="session-when cap">{when}</span></div>}
                      {shots.length > 0 && <div className="session-thumbs">{shots.map((p) => <span key={p.id}>{thumb(p, false)}</span>)}</div>}
                      <span className="session-actions">
                        {design?.downloadUrl ? <a className="ic ic-dl" href={design.downloadUrl} title="Download" aria-label={`Download the photo from ${when}`}><DownloadIcon /></a> : <span className="ic ic-dl" aria-hidden="true"><DownloadIcon /></span>}
                        <button className="ic ic-print" type="button" disabled={busy || !design || design.kind !== "DESIGN" || !design.downloadUrl} onClick={() => askReprint(s.id, design?.thumbUrl ?? null)} title="Print again" aria-label={`Print the photo from ${when} again`}><PrinterIcon /></button>
                        {s.galleryToken ? <a className="ic ic-link" href={`/g/${s.galleryToken}`} target="_blank" rel="noreferrer" title="Guest's link" aria-label={`Open the guest's link from ${when}`}><GlobeIcon /></a> : <span className="ic ic-link" aria-hidden="true"><GlobeIcon /></span>}
                        <button className="ic ic-del" type="button" disabled={busy} onClick={() => { if (confirm("Delete this guest's photos? This can't be undone.")) run("DELETE", `/events/${event.id}/sessions/${s.id}/photos`); }} title="Delete" aria-label={`Delete the photos from ${when}`}><TrashIcon /></button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <Link className="btn ghost" href={`?page=${data.page - 1}`} aria-disabled={data.page <= 1}>Previous</Link>
                <span className="cap">Page {data.page} of {pages}</span>
                <Link className="btn ghost" href={`?page=${data.page + 1}`} aria-disabled={data.page >= pages}>Next</Link>
              </nav>
            )}
          </div>
        </section>
        </div>
        <aside className="detail-side" aria-label="Share and export">
        <section className="host" aria-labelledby="share">
          <div className="host-head"><span className="cap">Every design from this event, on one private link</span><h2 id="share">Share with the client</h2></div>
          <div className="panel share">
            {link ? (
              <div className="share-row">
                {qr && <img src={qr} alt="QR code for the event gallery" className="share-qr" />}
                <div className="share-text">
                  <code className="share-link">{link}</code>
                  <div className="actions start">
                    <button className="btn" type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy link"}</button>
                    <a className="btn ghost" href={link} target="_blank" rel="noreferrer">Open</a>
                    <button className="btn warn" type="button" disabled={busy} onClick={() => run("POST", `/events/${event.id}/gallery/rotate`)}>New link (old one stops)</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="actions"><button className="btn" type="button" disabled={busy || !data.storageEnabled} onClick={() => run("POST", `/events/${event.id}/gallery`)}>Create share link</button></div>
            )}
            <label className="check center-check">
              <input type="checkbox" checked={data.galleryEnabled} disabled={busy} onChange={(e) => run("PATCH", `/events/${event.id}`, { config: { galleryEnabled: e.target.checked } })} />
              <span>Guests can open gallery links (QR codes and this link)</span>
            </label>
            <p className="cap center">Photos are deleted {data.retentionDays} days after the event ends. Change it on the event page.</p>
          </div>
        </section>
        <section className="host" aria-labelledby="export">
          <div className="host-head"><span className="cap">Straight from storage, as ZIP files</span><h2 id="export">Export</h2></div>
          <div className="panel">
            <div className="actions">
              <a className={"btn" + (ready ? "" : " disabled")} href={`/api/v1/events/${event.id}/export?kind=design`} aria-disabled={!ready}>Designs (ZIP)</a>
              <a className={"btn ghost" + (ready && data.saveOriginals ? "" : " disabled")} href={`/api/v1/events/${event.id}/export?kind=original`} aria-disabled={!ready || !data.saveOriginals}>Individual photos (ZIP)</a>
            </div>
            {!data.saveOriginals && <p className="cap center">This event saves only the finished design. Turn on “Also save each individual photo” on the event page to keep every shot (applies to new sessions).</p>}
          </div>
        </section>
        {(ready + waiting + failed) > 0 && (
          <section className="host" aria-labelledby="del">
            <div className="host-head"><span className="cap">From storage and every gallery</span><h2 id="del">Delete all photos</h2></div>
            <div className="panel">
              <div className="actions"><button className="btn warn" type="button" onClick={() => confirmAll.current?.showModal()}>Delete all event photos</button></div>
              <dialog ref={confirmAll} className="setup confirm" aria-labelledby="del-title">
                <span className="cap">{event.name}</span>
                <h2 id="del-title">Delete every photo?</h2>
                <p>All originals and designs are removed from storage, and every gallery link stops showing them. This can&apos;t be undone.</p>
                <div className="actions">
                  <button type="button" className="btn ghost" onClick={() => confirmAll.current?.close()}>Cancel</button>
                  <button type="button" className="btn warn" disabled={busy} onClick={async () => { if (await run("DELETE", `/events/${event.id}/photos`)) confirmAll.current?.close(); }}>Delete everything</button>
                </div>
              </dialog>
            </div>
          </section>
        )}
        </aside>
        <dialog ref={reprintBox} className="setup confirm reprint" aria-labelledby="rp-title" onClose={() => setReprint(null)}>
          <span className="cap">Print again</span>
          <h2 id="rp-title">{sent ? `Sent to ${sent}.` : "Choose a station"}</h2>
          {reprint?.thumb && <img className="reprint-photo" src={reprint.thumb} alt="The photo to print" />}
          {!sent && (stations === null ? <p className="cap">Looking for stations…</p> : stations.length === 0 ? <p>No station is online right now.</p> : (
            <div className="reprint-list">
              {stations.map((st) => <button key={st.id} className="btn ghost" type="button" disabled={busy} onClick={() => sendPrint(st)}>{st.name}{!st.ready && <small> · {st.lastError ?? "not ready"}</small>}</button>)}
            </div>
          ))}
          {printError && <p className="cap err" role="alert">{printError}</p>}
          <div className="actions">
            {!sent && <button type="button" className="btn ghost" disabled={busy} onClick={() => { setStations(null); void loadStations(); }}>Look again</button>}
            <button type="button" className={sent ? "btn" : "btn ghost"} onClick={() => reprintBox.current?.close()}>{sent ? "Done" : "Cancel"}</button>
          </div>
        </dialog>
      </main>
    </>
  );
}
