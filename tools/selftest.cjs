// app.js の計算ロジックを Node 上で直接動かして確かめる自己テスト。
//
//   node tools/selftest.cjs
//
// app.js はビルドせずそのまま配布する作りなので、テストのために中身を
// 分割したりモジュール化したりはしない。代わりに、末尾の描画開始行だけを
// 「中の関数を外に出す」1行に差し替えて vm で読み込む。
// こうすると app.js 本体には一切手を入れずに、実際に配布するコードと
// 同じものを検証できる。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app.js");
const src = fs.readFileSync(APP, "utf8");

// 取り出したい名前。app.js のトップレベルにある純粋な計算だけを対象にする
const EXPORTS = [
  "APP_VERSION", "escapeHtml", "fmt", "fmtL", "formLabel", "formOrder", "useLabel",
  "areaUnit", "volUnit", "dispArea", "areaSuffix", "dispVol", "volSuffix",
  "polygonAreaA", "segIntersects", "polygonSelfIntersects", "polygonCenter",
  "ptsMove", "ptsRemove", "ptsInsert", "drawMidpoints", "pushDrawHistory",
  "DRAW_HISTORY_MAX", "naviUrl", "fieldCenter", "planTankRefills",
  "shiftDate", "dateLabel", "newChem", "agriAmountUnit", "stripTrailingZeros",
  "agriNum", "normalizeChemName", "plannedLFromArea", "sprayVolumeL",
  "buildAgriGroups", "searchChemDb", "CHEM_SEARCH_LIMIT", "FIELD_COLOR",
  "syncFingerprint", "stampUpdated", "PROGRESS_STATES", "PROGRESS_RANK",
];

// 末尾の描画開始行を差し替える。ここが変わったらテスト側も直すこと
const RENDER_LINE = /ReactDOM\.createRoot\([^\n]*\);?\s*$/;
if (!RENDER_LINE.test(src)) {
  console.error("app.js の末尾に ReactDOM.createRoot(...) が見つかりません。");
  console.error("末尾の書き方を変えたなら tools/selftest.cjs の RENDER_LINE も直してください。");
  process.exit(2);
}
const patched = src.replace(RENDER_LINE, "globalThis.__t = { " + EXPORTS.join(", ") + " };");

// React も DOM も使わない関数だけを取り出すので、最低限の張りぼてで足りる
const noop = () => {};
const sandbox = {
  console,
  React: { createElement: (...a) => ({ __el: a }), useState: noop, useEffect: noop, useRef: noop, useMemo: noop, useLayoutEffect: noop, Fragment: "Fragment" },
  ReactDOM: { createRoot: () => ({ render: noop }) },
  document: { getElementById: () => ({}), querySelector: () => null, createElement: () => ({ style: {}, appendChild: noop }), head: { appendChild: noop }, addEventListener: noop },
  window: { addEventListener: noop, location: { href: "" }, navigator: {} },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: {},
  fetch: () => Promise.reject(new Error("no network in selftest")),
  setTimeout, clearTimeout, encodeURIComponent, isFinite, parseFloat, parseInt,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox, { filename: "app.js" });
const t = sandbox.__t;

// ── 判定 ────────────────────────────────────────────────
let pass = 0;
const fails = [];
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push(label + "\n    期待 " + w + "\n    実際 " + g);
};
const near = (label, got, want, tol) => {
  if (typeof got === "number" && Math.abs(got - want) <= tol) pass++;
  else fails.push(label + "\n    期待 " + want + " ±" + tol + "\n    実際 " + got);
};

// ── 面積から薬液量(調合タブ・作業タブ共通) ──────────────
eq("plannedL 100a×2L/10a", t.plannedLFromArea(100, 2), 20);
eq("plannedL 端数は0.01Lで丸める", t.plannedLFromArea(84.09, 2.3), 19.34);
eq("plannedL 文字列でも計算できる", t.plannedLFromArea("84.09", "2.3"), 19.34);
eq("plannedL 面積0なら0", t.plannedLFromArea(0, 2), 0);
eq("plannedL 投下量0なら0", t.plannedLFromArea(100, 0), 0);
eq("plannedL 空文字なら0", t.plannedLFromArea("", ""), 0);
eq("plannedL 負の値は0扱い", t.plannedLFromArea(-10, 2), 0);
eq("plannedL 数値以外は0扱い", t.plannedLFromArea("abc", 2), 0);

// ── 散布液量(実績があれば実績、なければ予定) ─────────────
eq("sprayVolume 実績優先", t.sprayVolumeL({ reported: true, sprayedL: 19.5, plannedL: 20 }), 19.5);
eq("sprayVolume 実績0なら調合量", t.sprayVolumeL({ reported: true, sprayedL: 0, totalL: 18 }), 18);
eq("sprayVolume 未実施は予定量", t.sprayVolumeL({ reported: false, plannedL: 20 }), 20);
eq("sprayVolume 何もなければ0", t.sprayVolumeL({}), 0);

// ── 面積計算(測地系。緯度で1度あたりの距離が変わる) ────────
const sq = (lat, lng, d) => [[lat, lng], [lat + d, lng], [lat + d, lng + d], [lat, lng + d]];
// 0.0009度 = 緯度方向で約100m。経度方向は cos(緯度) ぶん縮むので
// 北緯35度では約82m。よって 100m x 82m = 8200平方m = 約82a になる。
near("面積 0.0009度四方(北緯35度)は約82a", t.polygonAreaA(sq(35, 135, 0.0009)), 82.2, 0.5);
// 赤道上では緯度・経度が同じ長さになるので、同じ度数でも面積が大きくなる
near("面積 同じ度数でも赤道上では約100a", t.polygonAreaA(sq(0, 135, 0.0009)), 100.4, 0.5);
eq("面積 2点では0", t.polygonAreaA([[35, 135], [35.001, 135]]), 0);
eq("面積 空配列では0", t.polygonAreaA([]), 0);
eq("面積 nullでも落ちない", t.polygonAreaA(null), 0);
const a1 = t.polygonAreaA(sq(35, 135, 0.001));
const a2 = t.polygonAreaA(sq(35, 135, 0.002));
near("面積 一辺2倍で約4倍", a2 / a1, 4, 0.05);

// ── 自己交差(ねじれ)の判定 ───────────────────────────
const bowtie = [[35, 135], [35.001, 135.001], [35.001, 135], [35, 135.001]];
eq("交差 蝶ネクタイ形は交差あり", t.polygonSelfIntersects(bowtie), true);
eq("交差 正常な四角形は交差なし", t.polygonSelfIntersects(sq(35, 135, 0.001)), false);
eq("交差 三角形は交差なし", t.polygonSelfIntersects([[35, 135], [35.001, 135], [35, 135.001]]), false);
const concave = [[35, 135], [35.002, 135], [35.002, 135.002], [35.001, 135.002], [35.001, 135.001], [35, 135.001]];
eq("交差 L字(凹)は交差なし", t.polygonSelfIntersects(concave), false);
eq("交差 2点では判定しない", t.polygonSelfIntersects([[35, 135], [35.001, 135]]), false);

// ── 中心座標 ─────────────────────────────────────────
eq("中心 正方形の重心", t.polygonCenter([[0, 0], [2, 0], [2, 2], [0, 2]]), [1, 1]);
eq("中心 空配列はnull", t.polygonCenter([]), null);
// 共有データ経由で座標が文字列で入ってきても、連結せず数として足すこと。
// 連結すると中心が実在しない場所になり「ナビ」が見当違いの所を案内する。
eq("中心 座標が文字列でも数として扱う", t.polygonCenter([["0", "0"], ["2", "0"], ["2", "2"]]), t.polygonCenter([[0, 0], [2, 0], [2, 2]]));

// ── 液量の表示(mL→L) ──────────────────────────────────
eq("液量 20000mLは20L", t.fmtL(20000), "20");
eq("液量 端数は小数3桁まで", t.fmtL(1234), "1.234");
// 共有データから来た作業には水量が無いことがある。画面に「水 NaN L」と
// 出さないよう、fmt と同じく "—" を返すこと
eq("液量 未定義はダッシュ", t.fmtL(undefined), "—");
eq("液量 NaNはダッシュ", t.fmtL(NaN), "—");
eq("液量 0は0", t.fmtL(0), "0");

// ── 作図の頂点操作 ────────────────────────────────────
const pts = [[1, 1], [2, 2], [3, 3]];
eq("頂点移動", t.ptsMove(pts, 1, 9, 9), [[1, 1], [9, 9], [3, 3]]);
eq("頂点削除", t.ptsRemove(pts, 0), [[2, 2], [3, 3]]);
eq("頂点挿入 辺0の途中へ", t.ptsInsert(pts, 0, 1.5, 1.5), [[1, 1], [1.5, 1.5], [2, 2], [3, 3]]);
eq("頂点移動は元の配列を壊さない", pts, [[1, 1], [2, 2], [3, 3]]);
eq("中点 3頂点なら3つ(閉じた辺を含む)", t.drawMidpoints(pts).length, 3);
eq("中点 2頂点未満では作らない", t.drawMidpoints([[1, 1]]), []);

// ── 作図履歴の上限 ────────────────────────────────────
let hist = [];
for (let i = 0; i < t.DRAW_HISTORY_MAX + 20; i++) hist = t.pushDrawHistory(hist, [[i, i]]);
eq("履歴 上限を超えて溜まらない", hist.length, t.DRAW_HISTORY_MAX);
eq("履歴 古いものから捨てる", hist[hist.length - 1], [[t.DRAW_HISTORY_MAX + 19, t.DRAW_HISTORY_MAX + 19]]);

// ── タンク補給の区切り ────────────────────────────────
const w = (id, l) => ({ id, plannedL: l, reported: false });
const plan = t.planTankRefills([w(1, 80), w(2, 80), w(3, 80)], 200);
eq("タンク 3圃場で補給1回", [1, 2, 3].filter(id => plan[id].refill).length, 1);
eq("タンク 補給は3圃場目の前", !!plan[3].refill, true);
eq("タンク 補給直前までの使用量", plan[3].refill.usedL, 160);
eq("タンク 補給後は累計を数え直す", plan[3].cum, 80);
eq("タンク 補給後はタンク番号が進む", plan[3].tankNo, 2);
eq("タンク 1圃場で容量超過を検出", t.planTankRefills([w(1, 250)], 200)[1].over, true);
eq("タンク 容量未設定なら区切らない", !!t.planTankRefills([w(1, 80), w(2, 80), w(3, 80)], "")[3].refill, false);
eq("タンク 容量未設定でも累計は出す", t.planTankRefills([w(1, 80), w(2, 80), w(3, 80)], "")[3].cum, 240);
eq("タンク 予定未入力は0として扱う", t.planTankRefills([{ id: 1, plannedL: "" }], 200)[1].planned, 0);

// ── 薬剤名の正規化(半角カナ・全角英数を吸収) ──────────────
eq("正規化 半角カナ→全角", t.normalizeChemName("ﾍﾞｼﾞｾｲﾊﾞｰ"), "ベジセイバー");
eq("正規化 全角英数→半角", t.normalizeChemName("ＤＦ１０"), "DF10");
eq("正規化 前後の空白を落とす", t.normalizeChemName("  ダコニール  "), "ダコニール");
eq("正規化 null は空文字", t.normalizeChemName(null), "");

// ── 地図ラベルのエスケープ(XSS防止) ─────────────────────
eq("エスケープ タグ", t.escapeHtml("<script>x</script>"), "&lt;script&gt;x&lt;/script&gt;");
eq("エスケープ 引用符とアンパサンド", t.escapeHtml("a&\"b'c"), "a&amp;&quot;b&#39;c");
eq("エスケープ null は空文字", t.escapeHtml(null), "");

// ── アグリノート転記用の数値整形 ────────────────────────
eq("agriNum 末尾の0を落とす", t.agriNum(1.5, 3), "1.5");
eq("agriNum 整数はそのまま", t.agriNum(20, 3), "20");
eq("agriNum 0に丸まる値は有効数字で残す", t.agriNum(0.0004, 3), "0.0004");
eq("agriNum 固形は kg", t.agriAmountUnit("wp"), "kg");
eq("agriNum 液体は mL", t.agriAmountUnit("ec"), "mL");

// ── アグリノートのまとめ(同じ日×同じ調合で1グループ) ────────
const resolve = x => ({ name: "圃場" + x.fieldId, crop: "水稲", areaA: "100" });
const mkWork = (id, date, chems) => ({
  id, fieldId: id, workDate: date, reported: true, sprayedL: 20,
  reportAreaA: "100", totalL: 20, waterMl: 20000, chems,
});
const chemA = [{ name: "薬A", ratio: "1000", form: "ec", use: "fungicide" }];
const g1 = t.buildAgriGroups([mkWork(1, "2026-08-23", chemA), mkWork(2, "2026-08-23", chemA)], resolve);
eq("転記 同じ日×同じ調合は1グループ", g1.length, 1);
const g2 = t.buildAgriGroups([mkWork(1, "2026-08-23", chemA), mkWork(2, "2026-08-24", chemA)], resolve);
eq("転記 日が違えば別グループ", g2.length, 2);
const chemB = [{ name: "薬A", ratio: "1000", form: "wp", use: "fungicide" }];
const g3 = t.buildAgriGroups([mkWork(1, "2026-08-23", chemA), mkWork(2, "2026-08-23", chemB)], resolve);
eq("転記 剤型が違えば別グループ", g3.length, 2);
const g4 = t.buildAgriGroups([{ ...mkWork(1, "", chemA), workDate: "" }], resolve);
eq("転記 日付なしは除く", g4.length, 0);

// ── 日付 ─────────────────────────────────────────────
eq("日付 翌日", t.shiftDate("2026-08-23", 1), "2026-08-24");
eq("日付 前日", t.shiftDate("2026-08-23", -1), "2026-08-22");
eq("日付 月をまたぐ", t.shiftDate("2026-08-31", 1), "2026-09-01");
eq("日付 年をまたぐ", t.shiftDate("2026-12-31", 1), "2027-01-01");
eq("日付 うるう年", t.shiftDate("2028-02-28", 1), "2028-02-29");

// ── 単位換算 ─────────────────────────────────────────
eq("単位 a はそのまま", t.dispArea(100, "a"), "100");
eq("単位 未知のキーは既定(a)にする", t.areaUnit("zzz").key, t.areaUnit("a").key);
eq("単位 未知のキーは既定(L)にする", t.volUnit("zzz").key, t.volUnit("L").key);

// ── ナビのURL ────────────────────────────────────────
eq("ナビ 中心なしは無効リンク", t.naviUrl(null), "#");
eq("ナビ 中心ありは行き先つき", t.naviUrl([35.5, 135.5]).indexOf("destination=35.5,135.5") > 0, true);
eq("ナビ 圃場にcenterがなければ多角形から出す", t.fieldCenter({ polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] }), [1, 1]);
eq("ナビ 圃場がnullならnull", t.fieldCenter(null), null);

// ── 農薬データベース検索 ───────────────────────────────
// DBの列名は n=登録番号 nm=名称 u=用途 f=剤型 ig=有効成分
const db = [
  { n: 12345, nm: "ダコニール1000", u: "fungicide", f: "fl", ig: "TPN" },
  { n: 23456, nm: "ベジセイバー", u: "fungicide", f: "wp", ig: "銅" },
  { n: 23456, nm: "ベジセイバー", u: "fungicide", f: "wp", ig: "硫黄" },
];
eq("薬剤検索 登録番号", t.searchChemDb(db, "12345", true, false, false).length, 1);
eq("薬剤検索 名称", t.searchChemDb(db, "ダコニール", false, true, false).length, 1);
eq("薬剤検索 半角カナでも当たる", t.searchChemDb(db, "ﾍﾞｼﾞｾｲﾊﾞｰ", false, true, false).length, 1);
eq("薬剤検索 同じ登録番号は1行にまとめる", t.searchChemDb(db, "ベジセイバー", false, true, false).length, 1);
eq("薬剤検索 混合剤は成分をすべて出す", t.searchChemDb(db, "ベジセイバー", false, true, false)[0].ig, "銅・硫黄");
eq("薬剤検索 片方の成分で引いても両方出す", t.searchChemDb(db, "銅", false, false, true)[0].ig, "銅・硫黄");
eq("薬剤検索 対象外の列は引かない", t.searchChemDb(db, "TPN", true, true, false).length, 0);
eq("薬剤検索 完全一致を前方一致より上に出す", t.searchChemDb(db, "銅", false, false, true).length, 1);
// 空文字は全件一致になるが、呼び出し側(ChemSearchModal)が
// query が空なら検索そのものを行わないので画面には出ない
eq("薬剤検索 空文字は呼び出し側で弾く前提", t.searchChemDb(db, "", false, true, false).length, 2);

// ── 同期:変わったものにだけ時刻を打つ ─────────────────
// 全件に打つと、触っていないレコードまで「自分のほうが新しい」と主張して
// 他の端末の変更を踏み潰す。ここが壊れると、壊れたことに気づけないまま
// データが少しずつ消えていくので、必ず自動で見張る。
{
  const prev = [
    { id: 1, name: "北の田", updatedAt: "2026-08-01T00:00:00.000Z" },
    { id: 2, name: "南の田", updatedAt: "2026-08-01T00:00:00.000Z" },
  ];
  const next = [
    { id: 1, name: "北の田", updatedAt: "2026-08-01T00:00:00.000Z" },
    { id: 2, name: "南の田(改)", updatedAt: "2026-08-01T00:00:00.000Z" },
  ];
  const out = t.stampUpdated(next, prev);
  eq("同期 変わっていない行の時刻は動かさない", out[0].updatedAt, "2026-08-01T00:00:00.000Z");
  eq("同期 変わった行には新しい時刻が入る", out[1].updatedAt !== "2026-08-01T00:00:00.000Z", true);
  eq("同期 新規行にも時刻が入る",
     !!t.stampUpdated([{ id: 3, name: "新" }], prev)[0].updatedAt, true);

  // updatedAt / pushedAt そのものの変化は「変更」と数えない。
  // 数えると保存のたびに時刻が進み続け、送信が終わらなくなる
  const sent = [{ id: 1, name: "北の田", updatedAt: "2026-08-01T00:00:00.000Z",
                  pushedAt: "2026-08-01T00:00:00.000Z" }];
  eq("同期 送信済みフラグの付与は変更と数えない",
     t.stampUpdated(sent, prev)[0].updatedAt, "2026-08-01T00:00:00.000Z");
  eq("同期 指紋は updatedAt を無視する",
     t.syncFingerprint({ id: 1, a: 1, updatedAt: "x" }),
     t.syncFingerprint({ id: 1, a: 1, updatedAt: "y" }));
  eq("同期 指紋はキーの並び順に影響されない",
     t.syncFingerprint({ a: 1, b: 2 }), t.syncFingerprint({ b: 2, a: 1 }));
  eq("同期 中身が違えば指紋も違う",
     t.syncFingerprint({ a: 1 }) !== t.syncFingerprint({ a: 2 }), true);
}

// ── 進捗マップの状態 ───────────────────────────────────
{
  const keys = ["done", "local", "mixed", "planned", "none"];
  keys.forEach(k => {
    eq("進捗 " + k + " に色がある", !!(t.PROGRESS_STATES[k] || {}).fill, true);
    eq("進捗 " + k + " に見出しがある", !!(t.PROGRESS_STATES[k] || {}).label, true);
  });
  // 同じ圃場に複数の作業があるとき、いちばん進んだ状態を採るための順序
  eq("進捗 実績済が最上位",
     t.PROGRESS_RANK.done > t.PROGRESS_RANK.local, true);
  eq("進捗 未送信の実績は調合済より上",
     t.PROGRESS_RANK.local > t.PROGRESS_RANK.mixed, true);
  eq("進捗 調合済は未実績より上",
     t.PROGRESS_RANK.mixed > t.PROGRESS_RANK.planned, true);
  eq("進捗 対象外が最下位",
     t.PROGRESS_RANK.planned > t.PROGRESS_RANK.none, true);
}

// ── 版数の整合(sw.js と揃っているか) ───────────────────
const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const swVer = (sw.match(/CACHE_VERSION = "tankmix-(v[\d.]+)"/) || [])[1];
eq("版数 app.js と sw.js が一致", swVer, t.APP_VERSION);

// ── 結果 ─────────────────────────────────────────────
console.log("");
if (fails.length === 0) {
  console.log("  ✓ " + pass + " 件すべて成功");
  process.exit(0);
}
console.log("  ✓ 成功 " + pass + " 件 ／ ✗ 失敗 " + fails.length + " 件\n");
fails.forEach((f, i) => console.log("  " + (i + 1) + ". " + f + "\n"));
process.exit(1);
