// 薬液調合ノート — Service Worker(完全オフライン対応)
// 更新を配布するときは CACHE_VERSION の数字を上げてください
const CACHE_VERSION = "tankmix-v8.68";

// これが1つでも欠けるとアプリが起動しないので、揃わなければ更新を見送る。
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./react.production.min.js",
  "./react-dom.production.min.js",
  "./leaflet.js",
  "./leaflet.css",
  // chemdb.json はもう同梱していない(FAMICの利用規約により再配布しない)。
  // 各利用者が自分のGoogleドライブに置き、設定タブから取り込んで
  // IndexedDBに保存する。よってService Workerのキャッシュ対象ではない。
];

// 無くてもアプリは動くもの(アイコン・マニフェスト)。
// 圏外に近い場所でこれが1つ落ちただけで更新全体が失敗すると、
// 何度開き直しても古い版のままになるため、失敗しても先へ進める。
const OPTIONAL_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// cache:"reload" でブラウザのHTTPキャッシュを迂回する。GitHub Pagesは
// Cache-Control: max-age=600 を返すため、これが無いとデプロイ直後の更新で
// 古いファイルをそのままキャッシュに取り込んでしまう。
function fetchAndPut(cache, url) {
  return fetch(new Request(url, { cache: "reload" })).then((res) => {
    if (!res || !res.ok) throw new Error("取得失敗: " + url);
    return cache.put(url, res);
  });
}

// 圃場は電波が弱く、1回のfetchが落ちることが珍しくない。
// 1度きりの失敗で更新を諦めないよう、本体ファイルだけ1回だけ取り直す。
function fetchAndPutWithRetry(cache, url) {
  return fetchAndPut(cache, url).catch(() => fetchAndPut(cache, url));
}

// インストール時に全ファイルをキャッシュ。
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // 本体が揃わないまま skipWaiting すると、起動できないキャッシュに
      // 切り替わってしまう。ここで失敗させて古い版を残すほうが安全。
      Promise.all(CORE_ASSETS.map((url) => fetchAndPutWithRetry(cache, url)))
        .then(() => Promise.all(
          OPTIONAL_ASSETS.map((url) => fetchAndPut(cache, url).catch(() => {}))
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
  // 他サイトへの通信はキャッシュせず素通しする。
  // ここを通すと、国土地理院の住所検索(msearch.gsi.go.jp)や
  // GASの接続テスト(script.google.com)の応答まで保存され、
  // 以後ずっと同じ古い結果が返り続ける(検索し直しても変わらない)。
  // 地図タイルはブラウザのHTTPキャッシュに任せれば十分。
  if (new URL(e.request.url).origin !== self.location.origin) return;
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
