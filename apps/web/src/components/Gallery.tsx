"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { commonAspect } from "@/lib/aspect";
import { buttonOn, inkOn } from "@/lib/contrast";

interface Meta { reference: string | null; scope: "SESSION" | "EVENT"; event: { name: string; date: string; primaryColor: string; accentColor: string }; expiresAt: string; retentionDays: number; ready: number; pending: number }
interface Item { id: string; kind: "DESIGN" | "ORIGINAL"; index: number; width: number | null; height: number | null; thumbUrl: string; previewUrl: string; downloadUrl: string }

const Down = () => <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5L16.5 11" /><path d="M5 20h14" /></svg>;

// What guests (their own photos) and clients (the whole event) see. Every photo whole, in its own shape.
export function Gallery({ token }: { token: string }) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pages, setPages] = useState(1);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const api = `/api/v1/galleries/${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    try {
      const m = await fetch(api, { cache: "no-store" });
      if (m.status === 404 || m.status === 400) { setState("missing"); return; }
      if (!m.ok) { setState("error"); return; }
      const next: Meta = await m.json();
      const all: Item[] = [];
      for (let p = 1; p <= pages; p++) {
        const r = await fetch(`${api}/photos?page=${p}`, { cache: "no-store" });
        if (!r.ok) { setState("error"); return; }
        all.push(...(await r.json()).items);
      }
      setMeta(next); setItems(all); setState("ok");
    } catch { setState("error"); }
  }, [api, pages]);

  useEffect(() => { load(); }, [load]);
  // While photos are still arriving, check again every few seconds; otherwise refresh the
  // (15-minute) download links now and then so they never go stale on an open page.
  useEffect(() => {
    if (state !== "ok") return;
    const t = setInterval(load, meta && meta.pending > 0 ? 5000 : 10 * 60_000);
    return () => clearInterval(t);
  }, [state, meta, load]);

  useEffect(() => {
    const el = root.current;
    if (!el || !meta) return;
    const { primaryColor: bg, accentColor: accent } = meta.event;
    const b = buttonOn(bg, accent);
    el.style.setProperty("--g-bg", bg);
    el.style.setProperty("--g-accent", accent);
    el.style.setProperty("--g-ink", inkOn(bg));
    el.style.setProperty("--g-btn", b.fill);
    el.style.setProperty("--g-btn-ink", b.ink);
    const aspect = commonAspect(items);
    el.style.setProperty("--g-tile", aspect.toFixed(3));
    el.style.setProperty("--g-col", aspect < 0.5 ? "150px" : aspect < 1 ? "210px" : "280px");
  }, [meta, items]);

  const at = items.findIndex((p) => p.id === openId);
  const open = at >= 0 ? items[at] : null;
  const isOpen = !!open;
  const go = useCallback((by: number) => setOpenId((id) => { const i = items.findIndex((p) => p.id === id); return items[(i + by + items.length) % items.length]?.id ?? null; }), [items]);
  useEffect(() => {
    if (!isOpen) return;
    box.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [isOpen, go]);

  const expires = meta ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(meta.expiresAt)) : "";
  const label = (p: Item) => (p.kind === "DESIGN" ? "photo" : `photo ${p.index}`);

  return (
    <div ref={root} className="gal">
      {state === "loading" && <p className="gal-note">Loading your photos…</p>}
      {state === "missing" && (
        <div className="gal-empty"><h1>This link isn&apos;t available.</h1><p>It may have expired or been turned off by the photographer.</p></div>
      )}
      {state === "error" && (
        <div className="gal-empty"><h1>That didn&apos;t load.</h1><p>Check your connection and try again.</p><button type="button" className="gal-btn" onClick={load}>Try again</button></div>
      )}
      {state === "ok" && meta && (
        <>
          <header className="gal-head">
            <p className="gal-cap">{meta.event.date}</p>
            <h1>{meta.event.name}</h1>
            <p className="gal-cap">{meta.scope === "SESSION" ? "Your photos" : `${meta.ready} photo${meta.ready === 1 ? "" : "s"}`}</p>
            {meta.ready > 1 && <a className="gal-btn" href={`${api}/zip`}><Down />Download all (ZIP)</a>}
          </header>
          {items.length === 0 && meta.pending > 0 && <p className="gal-note pulse">Your photos are on their way. This page fills in by itself.</p>}
          {items.length === 0 && meta.pending === 0 && <p className="gal-note">No photos here yet.</p>}
          <main className={`gal-grid ${meta.scope === "SESSION" ? "session" : "event"}${items.length < 3 ? " few" : ""}`}>
            {items.map((p) => (
              <figure key={p.id} className={p.kind === "DESIGN" ? "design" : "shot"}>
                <button type="button" className="gal-photo" onClick={() => setOpenId(p.id)} aria-label={`View ${label(p)}`}>
                  <img src={meta.scope === "SESSION" && p.kind === "DESIGN" ? p.previewUrl : p.thumbUrl} alt="" loading="lazy" />
                </button>
                <a className="gal-btn" href={p.downloadUrl} aria-label={`Download ${label(p)}`}><Down />Download</a>
              </figure>
            ))}
          </main>
          {items.length < meta.ready && <div className="gal-more"><button type="button" className="gal-btn outline" onClick={() => setPages((n) => n + 1)}>Show more</button></div>}
          {meta.pending > 0 && items.length > 0 && <p className="gal-note pulse">{meta.pending} more on the way…</p>}
          <footer className="gal-foot">
            {meta.reference && <p>Your reference: <b>{meta.reference}</b></p>}
            Private link: only people who have it can see these photos. They&apos;re deleted after {expires}.
          </footer>
        </>
      )}
      {open && (
        <div ref={box} className="gal-box" role="dialog" aria-modal="true" aria-label="Photo" tabIndex={-1} onClick={() => setOpenId(null)}>
          <img src={open.previewUrl} alt="" />
          <div className="gal-box-actions" onClick={(e) => e.stopPropagation()}>
            {items.length > 1 && <button type="button" className="gal-btn ghost icon" onClick={() => go(-1)} aria-label="Previous photo">‹</button>}
            <a className="gal-btn" href={open.downloadUrl}><Down />Download</a>
            <button type="button" className="gal-btn ghost" onClick={() => setOpenId(null)}>Close</button>
            {items.length > 1 && <button type="button" className="gal-btn ghost icon" onClick={() => go(1)} aria-label="Next photo">›</button>}
          </div>
        </div>
      )}
    </div>
  );
}
