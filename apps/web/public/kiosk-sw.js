// pbooth kiosk offline helper (service worker), scope /kiosk/.
// Keeps a copy of the kiosk page and its app files so a kiosk reloaded during an internet outage
// still opens and keeps serving guests. API calls are never cached: the kiosk's own outbox
// (IndexedDB) handles sending sessions and photos once the network is back.
const CACHE = "pbooth-kiosk-v1";
// An event frame never changes under its id either: cached like the app files, so a kiosk prints its frame offline.
const STATIC = /^\/(_next\/static\/|theme\.js|logo-|favicon|apple-touch-icon|api\/v1\/frames\/)/;

// /kiosk/PB-7K3M and /kiosk/PB-7K3M/session/<id> are the same app: store one copy per booth.
const pageKey = (path) => {
  const m = /^\/kiosk\/([^/]+)/.exec(path);
  return m ? `/kiosk/${m[1]}` : null;
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page sends the files it loaded, so they're kept even from the very first visit.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "warm") return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of e.data.urls ?? []) {
      const url = new URL(u, self.location.origin);
      if (url.origin !== self.location.origin) continue;
      const key = url.pathname.startsWith("/kiosk/") ? pageKey(url.pathname) : STATIC.test(url.pathname) ? url.pathname + url.search : null;
      if (!key || (await cache.match(key))) continue;
      try { const r = await fetch(url, { credentials: "same-origin" }); if (r.ok) await cache.put(key, r); } catch { /* offline right now */ }
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return; // agent, storage, API writes: untouched

  if (e.request.mode === "navigate" && pageKey(url.pathname)) {
    // Network first (fresh code and config when online), the saved copy when not.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await fetch(e.request, { signal: AbortSignal.timeout(6000) });
        if (r.ok) await cache.put(pageKey(url.pathname), r.clone());
        return r;
      } catch {
        return (await cache.match(pageKey(url.pathname))) ?? new Response("This kiosk hasn't been opened online yet.", { status: 503, headers: { "content-type": "text/plain" } });
      }
    })());
    return;
  }

  if (STATIC.test(url.pathname)) {
    // Built files never change under the same name: the saved copy is always right.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(url.pathname + url.search);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) await cache.put(url.pathname + url.search, r.clone());
      return r;
    })());
  }
});
