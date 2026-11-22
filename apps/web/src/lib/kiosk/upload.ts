"use client";
import { kioskFetch } from "./api";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * One photo to the private bucket: ask the API for a signed link bound to this file's size and
 * SHA-256, PUT the bytes straight to storage, then confirm. Retries through network blips.
 * Returns true once the server has it.
 * shortcut: retries live in this page's memory; surviving a closed browser or long outage is Phase 6.
 */
export async function uploadPhoto(sessionId: string, blob: Blob, kind: "DESIGN" | "ORIGINAL", index: number): Promise<boolean> {
  const bytes = await blob.arrayBuffer();
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const photoId = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt)));
    const a = await kioskFetch<{ alreadyUploaded: boolean; url?: string; headers?: Record<string, string> }>("POST", "/photos/upload-authorize", {
      photoId, sessionId, kind, index, sha256, size: bytes.byteLength, contentType: "image/jpeg",
    });
    if (!a.ok) {
      if (a.status === 0 || a.status >= 500 || a.code === "SESSION_UNKNOWN") continue; // offline, or the session start hasn't landed yet
      return false; // a real refusal (storage off, not this booth's session…)
    }
    if (!a.data.alreadyUploaded) {
      try {
        const put = await fetch(a.data.url!, { method: "PUT", body: bytes, headers: a.data.headers });
        if (!put.ok) continue;
      } catch { continue; }
    }
    const c = await kioskFetch("POST", "/photos/upload-complete", { photoId });
    if (c.ok) return true;
    if (c.status >= 400 && c.status < 500 && c.status !== 409) return false;
  }
  return false;
}

/** 256 random bits for the guest's QR link, made here so the QR works even if the network is down. */
export const newGalleryToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
