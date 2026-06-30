// ともたろぐ Service Worker
// キャッシュ戦略: Cache First (アプリシェル) + Stale While Revalidate (CDNスクリプト)

const CACHE_NAME  = "tomotalog-v1.13";
const CDN_CACHE   = "tomotalog-cdn-v1.13";

// アプリシェル（ローカルファイル）
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// CDNスクリプト（別キャッシュで管理）
const CDN_SCRIPTS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

// ── install: アプリシェルとCDNを先読みキャッシュ ─────────────
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

// ── activate: 古いキャッシュを削除 ───────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── fetch: リクエスト別にキャッシュ戦略を切り替え ────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // CDNスクリプト → Stale While Revalidate
  if (CDN_SCRIPTS.includes(request.url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // 同一オリジンのGET → Cache First
  if (request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // その他（POST等）→ ネットワーク優先
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// ── キャッシュ戦略ヘルパー ────────────────────────────────────

// Cache First: キャッシュにあればそれを返す。なければ fetch してキャッシュ登録
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // オフライン時: index.htmlにフォールバック
    return cache.match("./index.html");
  }
}

// Stale While Revalidate: キャッシュを即返しつつ、バックグラウンドで更新
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
