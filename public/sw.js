// Kalculator service worker — runtime caching for offline use.
// Strategy: stale-while-revalidate for same-origin GET requests. After the
// first online visit, the app shell + hashed assets are cached, so it launches
// and works fully offline. Cross-origin requests (e.g. Google Fonts) are not
// cached; the webfonts are self-hosted, so they are cached with the app assets.
const CACHE = "kalculator-v2";

// UI icons are small self-hosted SVGs; precache them so panels opened for the
// first time while offline (help, about, documents) still show their icons.
// Keep in sync with public/icons/ui/.
const ICONS = [
  "backspace", "angle", "bulb", "check", "close", "code", "coffee", "copy", "cut", "dots", "duplicate", "edit", "eraser", "file", "file-plus", "folder", "github", "globe", "graph", "hand", "heart", "info", "keyboard", "left", "mail", "pages", "paste", "paypal", "plus", "redo", "right", "save", "select", "sliders", "trash", "undo", "up"
].map((n) => `icons/ui/${n}.svg`);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ICONS)).catch(() => {}));
});

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
