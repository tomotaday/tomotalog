// ともたろぐ Service Worker
// キャッシュ戦略: index.html = Network First（常に最新を優先） / その他アプリシェル = Cache First / CDNスクリプト = Stale While Revalidate

// ⚠️ index.html の DATA_VERSION を上げたら、必ずこの SW_VERSION も同じ値に揃えること。
//    ここを変えることで sw.js 自体のバイト内容が変わり、ブラウザが「新しいSWがある」と検知できる。
//    （ブラウザは sw.js を byte-for-byte 比較して更新を検知するため、中身が1文字も変わらないと
//    　index.html だけ差し替えても新しいSWはインストールされない）
const SW_VERSION = "1.17.2";

const CACHE_NAME = `tomotalog-v${SW_VERSION}`;
const CDN_CACHE  = `tomotalog-cdn-v${SW_VERSION}`;

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

// ── install: アプリシェルとCDNを先読みキャッシュし、待たずに即有効化 ─────
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(CDN_CACHE).then((cache) =>
        Promise.allSettled(CDN_SCRIPTS.map((url) => cache.add(url)))
      ),
    ]).then(() => self.skipWaiting()) // 新しいSWを待機させず即座にactivateへ進める
  );
});

// ── activate: 古いバージョンのキャッシュを削除し、既存タブも即座に新SW管理下に置く ─
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // 起動中のタブも含め、今すぐ新SWを使わせる
  );
});

// ── fetch: リクエスト別にキャッシュ戦略を切り替え ────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // index.html（ホーム画面起動時のnavigateリクエストも含む）→ Network First
  // 新しいindex.htmlがあれば常にそれを優先して取得し、オフライン時のみキャッシュにフォールバック
  const isIndexRequest =
    request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/");
  if (isIndexRequest && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, CACHE_NAME, "./index.html"));
    return;
  }

  // CDNスクリプト → Stale While Revalidate
  if (CDN_SCRIPTS.includes(request.url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // その他同一オリジンのGET（manifest・アイコン等）→ Cache First
  if (request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // その他（POST等）→ ネットワーク優先
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// ── キャッシュ戦略ヘルパー ────────────────────────────────────

// Network First: まずネットワークから取得。取れたらキャッシュも更新。
// オフライン等で失敗した場合のみキャッシュ（なければfallbackPath）を返す。
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
