// Bugsy technician app service worker: the app shell and its assets stay available with no signal.
// Navigations to /tech: network first, cached copy when offline. Static assets: cache first.
// The route itself lives in IndexedDB on the device; the sync queue never goes through here.
const CACHE = "bugsy-tech-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isTechNavigation(request, url) {
  return request.mode === "navigate" && url.pathname.startsWith("/tech");
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || /\.(?:js|css|woff2?|svg|png|ico)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isTechNavigation(request, url)) {
    // Only the app shell itself ("/tech") is cached and served offline; a summary page under /tech never replaces it.
    const isShell = url.pathname === "/tech";
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isShell && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/tech", copy));
          }
          return response;
        })
        .catch(() =>
          (isShell ? caches.match("/tech") : Promise.resolve(undefined)).then(
            (cached) => cached || new Response("Offline and no cached app yet. Open the app once while online.", { status: 503, headers: { "content-type": "text/plain" } }),
          ),
        ),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
