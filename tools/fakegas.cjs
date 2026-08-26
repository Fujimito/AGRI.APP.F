// Code.gs をローカルで動かす確認用サーバー。
//
//   node tools/fakegas.cjs            → http://127.0.0.1:8932/exec
//   node tools/fakegas.cjs 9000 秘密   → ポートと合言葉(SHARED_SECRET)を指定
//
// アプリの設定タブの「送信先URL」にこのURLを入れると、Googleに何も送らずに
// 送信・同期・進捗マップの動作を確かめられる。実際に流れるのは Code.gs の
// コードそのもの(tools/gasharness.cjs がスプレッドシートだけを差し替えている)。
//
// ★これは開発中の確認用であって、本番の受信口ではない。
//   - 127.0.0.1 にだけ待ち受ける(同じ端末からしか繋がらない)
//   - データはメモリ上だけ。落とすと消える
//   - 合言葉を指定しなければ誰でも書き込める
//   配布物ではない(GitHub Pages には置かれない)。
"use strict";
const http = require("http");
const { makeContext } = require("./gasharness.cjs");

const port = Number(process.argv[2]) || 8932;
const secret = process.argv[3] || "";
const ctx = makeContext(secret ? { SHARED_SECRET: secret } : {});

// ブラウザから直接叩けるようにする。GAS のウェブアプリも同じように
// どのオリジンからでも受ける設定(アクセス:全員)で動いている
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const send = (res, obj) => {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(200, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS));
  res.end(body);
};

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method === "GET") {
    send(res, ctx.doGet().getContent());
    return;
  }
  // チャンクを文字列として継ぎ足してはいけない。日本語はUTF-8で3バイトあり、
  // チャンクの切れ目が文字の途中に来るとそこだけ化けて JSON.parse が失敗する。
  // 小さい送信では再現せず、圃場をまとめて送ったときだけ失敗する。
  const chunks = [];
  let size = 0;
  req.on("data", c => {
    size += c.length;
    // 送信元はローカルのブラウザだけだが、無制限に受けると
    // 打ち間違いひとつでメモリを食い潰す
    if (size > 5e6) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      send(res, ctx.doPost({ postData: { contents: body } }).getContent());
    } catch (err) {
      // 確認用サーバーなので、原因が分かるようその場に出す
      console.error("doPost failed:", err);
      send(res, { ok: false, error: String(err) });
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("確認用GAS: http://127.0.0.1:" + port + "/exec");
  console.log("合言葉: " + (secret ? "あり" : "なし(未設定)"));
  console.log("Ctrl+C で終了。データはメモリ上だけで、終了すると消えます。");
});
