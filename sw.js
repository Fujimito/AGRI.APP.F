// 薬液調合ノート — Service Worker(完全オフライン対応)
// 更新を配布するときは CACHE_VERSION の数字を上げてください
const CACHE_VERSION = "tankmix-v8.21";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./react.production.min.js",
  "./react-dom.production.min.js",
  "./leaflet.js",
  "./leaflet.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// インストール時に全ファイルをキャッシュ。
// cache:"reload" でブラウザのHTTPキャッシュを迂回する。GitHub Pagesは
// Cache-Control: max-age=600 を返すため、これが無いとデプロイ直後の更新で
// 古いファイルをそのままキャッシュに取り込んでしまう。
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        fetch(new Request(url, { cache: "reload" })).then((res) => {
          if (!res || !res.ok) throw new Error("取得失敗: " + url);
          return cache.put(url, res);
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

// 古いバージョンのキャッシュを削除
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ優先(圏外でも動作)、裏でネット更新があれば次回反映
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
