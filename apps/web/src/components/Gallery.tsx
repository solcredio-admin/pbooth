"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Meta { reference: string | null; scope: "SESSION" | "EVENT"; event: { name: string; date: string; primaryColor: string; accentColor: string }; expiresAt: string; retentionDays: number; ready: number; pending: number }
interface Item { id: string; kind: "DESIGN" | "ORIGINAL"; index: number; width: number | null; height: number | null; thumbUrl: string; previewUrl: string; downloadUrl: string }

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function Gallery({ token }: { token: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [open, setOpen] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await fetch(`/api/v1/galleries/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (m.status === 404 || m.status === 400) { setState("missing"); return; }
      if (!m.ok) { setState("error"); return; }
      const meta: Meta = await m.json();
      const p = await fetch(`/api/v1/galleries/${encodeURIComponent(token)}/photos`, { cache: "no-store" }).then((r) => r.json());
      setMeta(meta); setItems(p.items); setState("ok");
    } catch { setState("error"); }
  }, [token]);

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
    el.style.setProperty("--g-bg", meta.event.primaryColor);
    el.style.setProperty("--g-accent", meta.event.accentColor);
    el.style.setProperty("--g-ink", luminance(meta.event.primaryColor) > 0.55 ? "#141414" : "#f6f5f0");
  }, [meta]);

  const expires = meta ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(meta.expiresAt)) : "";

  return (
    <div ref={root} className="gal">
      {state === "loading" && <p className="gal-note">Loading your photos…</p>}
      {state === "missing" && (
        <div className="gal-empty"><h1>This link isn't available.</h1><p>It may have expired or been turned off by the photographer.</p></div>
      )}
      {state === "error" && (
        <div className="gal-empty"><h1>That didn't load.</h1><p>Check your connection and try again.</p><button type="button" className="gal-btn" onClick={load}>Try again</button></div>
      )}
      {state === "ok" && meta && (
        <>
          <header className="gal-head">
            <p className="gal-cap">{meta.event.date}</p>
            <h1>{meta.event.name}</h1>
            <p className="gal-cap">{meta.scope === "SESSION" ? "Your photos" : "Event gallery"}</p>
          </header>
          {items.length === 0 && meta.pending > 0 && <p className="gal-note pulse">Your photos are on their way. This page fills in by itself.</p>}
          {items.length === 0 && meta.pending === 0 && <p className="gal-note">No photos here yet.</p>}
          <main className={`gal-grid ${meta.scope === "SESSION" ? "session" : "event"}`}>
            {items.map((p) => (
              <figure key={p.id} className={p.kind === "DESIGN" ? "design" : "shot"}>
                <button type="button" onClick={() => setOpen(p)} aria-label={`Open ${p.kind === "DESIGN" ? "design" : `photo ${p.index}`}`}>
                  <img src={meta.scope === "SESSION" && p.kind === "DESIGN" ? p.previewUrl : p.thumbUrl} alt="" loading="lazy" />
                </button>
                <a className="gal-btn" href={p.downloadUrl}>Download</a>
              </figure>
            ))}
          </main>
          {meta.pending > 0 && items.length > 0 && <p className="gal-note pulse">{meta.pending} more on the way…</p>}
          <footer className="gal-foot">
            {meta.reference && <p>Your reference: <b>{meta.reference}</b></p>}
            Private link: only people who have it can see these photos. They&apos;re deleted after {expires}.
          </footer>
        </>
      )}
      {open && (
        <div className="gal-box" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(null)}>
          <img src={open.previewUrl} alt="" />
          <div className="gal-box-actions" onClick={(e) => e.stopPropagation()}>
            <a className="gal-btn" href={open.downloadUrl}>Download full size</a>
            <button type="button" className="gal-btn ghost" onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
