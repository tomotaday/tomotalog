// ともたろぐ2.0 Service Worker
// index.html = Network First / アプリシェル = Cache First / CDNスクリプト = Stale While Revalidate

// ⚠️ index.html の DATA_VERSION を上げたら、必ずこの SW_VERSION も同じ値に揃えること。
const SW_VERSION = "2.1.0";

const CACHE_NAME = `tomotalog2-v${SW_VERSION}`;
const CDN_CACHE  = `tomotalog2-cdn-v${SW_VERSION}`;

const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

const CDN_SCRIPTS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(CDN_CACHE).then((cache) =>
        Promise.allSettled(CDN_SCRIPTS.map((url) => cache.add(url)))
      ),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== CDN_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isIndexRequest =
    request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/");
  if (isIndexRequest && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, CACHE_NAME, "./index.html"));
    return;
  }

  if (CDN_SCRIPTS.includes(request.url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  if (request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return cache.match(fallbackPath);
  }
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return cache.match("./index.html");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || fetchPromise;
}
