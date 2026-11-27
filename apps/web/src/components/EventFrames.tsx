"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadTemplate, FRAME_LAYOUTS, frameKey } from "@/lib/template/frame-template";
import type { EventDto } from "@/lib/types";

/** The owner's own frames: one PNG per layout and number of photos, drawn over the photos. */
export function EventFrames({ event, readOnly }: { event: EventDto; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const have = new Map(event.frames.map((f) => [frameKey(f.layout, f.shots), f]));
  const c = event.config;
  // what this event shoots now; self-service guests may pick other layouts and numbers of photos
  const current = c && frameKey(event.kind === "SELF_SERVICE" && c.layout === "strip" ? "landscape" : c.layout, c.shotsPerSession);
  const layouts = FRAME_LAYOUTS.filter((l) => event.kind === "MANAGED" || l.layout !== "strip");

  const upload = async (layout: string, shots: number, file?: File) => {
    if (!file) return;
    const key = frameKey(layout, shots);
    setBusy(key); setError(null);
    try {
      const r = await fetch(`/api/v1/events/${event.id}/frames/${layout}/${shots}`, { method: "PUT", headers: { "content-type": "image/png" }, body: file, credentials: "same-origin" });
      if (!r.ok) setError({ key, text: (await r.json().catch(() => null))?.error?.message ?? `Upload failed (${r.status})` });
    } catch { setError({ key, text: "Can't reach the server. Try again." }); }
    setBusy(null);
    router.refresh();
  };
  const remove = async (layout: string, shots: number) => {
    if (!confirm("Remove this frame? Photos in this layout get the built-in design again.")) return;
    setBusy(frameKey(layout, shots));
    await fetch(`/api/v1/events/${event.id}/frames/${layout}/${shots}`, { method: "DELETE", credentials: "same-origin" });
    setBusy(null);
    router.refresh();
  };

  return (
    <section className="host" aria-labelledby="frames">
      <div className="host-head"><span className="cap">A PNG the size of the print, see-through where the photos go, replaces the built-in design</span><h2 id="frames">Your own frames</h2></div>
      <div className="panel">
        <p className="cap">Download the template for a layout, design over it (Canva, Photoshop, Procreate), keep the photo spots see-through, export as PNG and upload it here. It&apos;s used the next time a guest finishes.</p>
        <ul className="frames">
          {layouts.map(({ layout, shots, name }) => {
            const key = frameKey(layout, shots), f = have.get(key);
            return (
              <li key={key} className={key === current ? "now" : undefined}>
                <div className="frame-art">
                  {f ? <img src={`/api/v1/frames/${f.id}`} alt={`Your frame for ${name}, ${shots} photos`} /> : <span className="cap">Built-in design</span>}
                </div>
                <div className="frame-name"><b>{name}</b><span className="cap">{shots} photo{shots === 1 ? "" : "s"}{key === current ? " · this event now" : ""}</span></div>
                <div className="frame-acts">
                  <button className="row-btn" type="button" onClick={() => downloadTemplate(layout, shots, name)}>Template</button>
                  {!readOnly && <>
                    <button className="row-btn" type="button" disabled={!!busy} onClick={() => document.getElementById(`frame-${key}`)?.click()} aria-label={`${f ? "Replace" : "Upload"} the frame for ${name}, ${shots} photos`}>{busy === key ? "Uploading…" : f ? "Replace" : "Upload"}</button>
                    <input id={`frame-${key}`} type="file" accept="image/png" hidden onChange={(e) => { void upload(layout, shots, e.target.files?.[0]); e.target.value = ""; }} />
                  </>}
                  {!readOnly && f && <button className="row-btn danger" type="button" disabled={!!busy} onClick={() => remove(layout, shots)}>Remove</button>}
                </div>
                {error?.key === key && <p className="cap err" role="alert">{error.text}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
