// Kalculator service worker — runtime caching for offline use.
// Strategy: stale-while-revalidate for same-origin GET requests. After the
// first online visit, the app shell + hashed assets are cached, so it launches
// and works fully offline. Cross-origin requests (e.g. Google Fonts) are not
// cached; the webfonts are self-hosted, so they are cached with the app assets.
const CACHE = "kalculator-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return; // let the network handle it
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      // serve cache immediately if present (revalidating in the background),
      // otherwise wait for the network; fall back to a cached navigation when offline.
      return cached || (await network) || (await cache.match("./")) || Response.error();
    })(),
  );
});
