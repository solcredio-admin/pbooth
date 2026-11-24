"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { send } from "@/lib/client-api";
import type { EventDto, EventPhotos } from "@/lib/types";

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function EventGallery({ event, data, origin }: { event: EventDto; data: EventPhotos; origin: string }) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const confirmAll = useRef<HTMLDialogElement>(null);
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
      <main>
        {!data.storageEnabled && (
          <p className="notice cap">Photo storage isn&apos;t set up yet, so photos aren&apos;t being saved. See <Link href="/settings">Settings → Storage</Link>.</p>
        )}
        {error && <p className="notice cap" role="alert">{error}</p>}

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

        <section className="host" aria-labelledby="sess">
          <div className="host-head"><span className="cap">{data.total} guest sessions with photos</span><h2 id="sess">Sessions</h2></div>
          <div className="panel">
            {data.sessions.length === 0 ? <p className="cap center">No photos yet.</p> : (
              <ul className="sessions">
                {data.sessions.map((s) => {
                  const design = s.photos.find((p) => p.kind === "DESIGN") ?? s.photos[0];
                  const shots = s.photos.filter((p) => p !== design);
                  const thumb = (p: typeof design, big: boolean) => p.thumbUrl
                    ? <img src={p.thumbUrl} alt={p.kind === "DESIGN" ? "Design" : `Photo ${p.index}`} loading="lazy" className={big ? "design" : undefined} />
                    : <span className={`thumb-status s-${p.status}${big ? " big" : ""}`} title={p.error ?? undefined}>{p.status.toLowerCase()}</span>;
                  return (
                    <li key={s.id}>
                      {design && (design.downloadUrl
                        ? <a className="session-main" href={design.downloadUrl} title="Download full size">{thumb(design, true)}</a>
                        : <div className="session-main">{thumb(design, true)}</div>)}
                      {shots.length > 0 && (
                        <div className="session-thumbs">
                          {shots.map((p) => p.downloadUrl
                            ? <a key={p.id} href={p.downloadUrl} title={`Download photo ${p.index}`}>{thumb(p, false)}</a>
                            : <span key={p.id}>{thumb(p, false)}</span>)}
                        </div>
                      )}
                      <span className="cap session-when">{time(s.startedAt, event.timeZone)} · {s.booth?.name ?? "Deleted booth"}</span>
                      <span className="session-actions">
                        {design?.downloadUrl && <a className="plain cap" href={design.downloadUrl}>Download</a>}
                        {s.galleryToken && <a className="plain cap" href={`/g/${s.galleryToken}`} target="_blank" rel="noreferrer">Guest link</a>}
                        <button className="plain cap danger" type="button" disabled={busy} onClick={() => { if (confirm("Delete this guest's photos? This can't be undone.")) run("DELETE", `/events/${event.id}/sessions/${s.id}/photos`); }}>Delete</button>
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
      </main>
    </>
  );
}
