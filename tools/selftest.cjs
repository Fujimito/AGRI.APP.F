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
  "ptsMove", "ptsRemove", "ptsInsert", "drawMidpoints", "pushDrawHistory", "untwistPts",
  "DRAW_HISTORY_MAX", "naviUrl", "fieldCenter", "planTankRefills",
  "shiftDate", "dateLabel", "newChem", "agriAmountUnit", "stripTrailingZeros",
  "agriNum", "normalizeChemName", "plannedLFromArea", "sprayVolumeL",
  "buildAgriGroups", "searchChemDb", "CHEM_SEARCH_LIMIT", "FIELD_COLOR",
  "syncFingerprint", "stampUpdated", "PROGRESS_STATES", "PROGRESS_RANK",
  "PROGRESS_ORDER", "toMapStatus", "workIdFor", "keepLocalEdit", "geoWatch", "labelsVisible", "PROGRESS_LABEL_MIN_ZOOM", "fieldDrawSig", "diffDraw", "geoHintFor",
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

// ── ねじれの並べ替え ───────────────────────────────────
{
  // 同じ四角形を、時計回りと反時計回りで打った場合。
  // 「反時計回りだとねじれる」という思い込みが起きやすいが、実際は一致する。
  const cw = [[33.20, 130.40], [33.20, 130.41], [33.19, 130.41], [33.19, 130.40]];
  const ccw = cw.slice().reverse();
  eq("回り方 時計回りは交差しない", t.polygonSelfIntersects(cw), false);
  eq("回り方 反時計回りも交差しない", t.polygonSelfIntersects(ccw), false);
  eq("回り方 面積は向きによらず同じ",
     Math.round(t.polygonAreaA(cw) * 1000), Math.round(t.polygonAreaA(ccw) * 1000));

  // 交差するのは「外周をたどる順に打っていない」とき。
  // 左 → 右上 → 左下 → 右 の順(利用者が実際に踏んだ形)
  const bow = [[33.20, 130.400], [33.21, 130.420], [33.18, 130.405], [33.195, 130.430]];
  eq("並び順 行き来する順は交差する", t.polygonSelfIntersects(bow), true);

  const fixed = t.untwistPts(bow);
  eq("並び順 直したら交差しない", t.polygonSelfIntersects(fixed), false);
  eq("並び順 頂点の数は変わらない", fixed.length, bow.length);
  // 座標そのものは1つも動かさない(並べ替えるだけ)
  const key = a => a.map(p => p.join(",")).sort().join(" / ");
  eq("並び順 座標の集合は変わらない", key(fixed), key(bow));
  // ねじれが解けるので、面積は打ち消し合っていた状態より大きくなる
  eq("並び順 直すと面積が正しくなる", t.polygonAreaA(fixed) > t.polygonAreaA(bow), true);

  // すでに正しい形は壊さない
  eq("並び順 正しい形は交差したままにならない",
     t.polygonSelfIntersects(t.untwistPts(cw)), false);
  eq("並び順 3点以下はそのまま返す",
     t.untwistPts([[1, 1], [2, 2], [3, 3]]).length, 3);
  eq("並び順 配列でなければそのまま返す", t.untwistPts(null), null);
}

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
  // 古い配列を元に保存されたとき、時刻が過去へ戻らないこと。
  // 戻ると pushedAt のほうが新しくなり、一度送った時点で「送信済み」と
  // 判定されて、中身が違うままサーバーとの食い違いが固まる(実機で発生した)
  {
    const saved = [{ id: 1, name: "北の田",
                     updatedAt: "2026-08-26T05:00:00.000Z",
                     pushedAt: "2026-08-26T05:00:00.000Z" }];
    const stale = [{ id: 1, name: "北の田",
                     updatedAt: "2026-08-26T01:00:00.000Z" }];
    const out = t.stampUpdated(stale, saved);
    eq("同期 時刻は過去へ戻らない", out[0].updatedAt, "2026-08-26T05:00:00.000Z");
    eq("同期 送信済みの時刻も保存側を引き継ぐ", out[0].pushedAt, "2026-08-26T05:00:00.000Z");
  }
  eq("同期 指紋はキーの並び順に影響されない",
     t.syncFingerprint({ a: 1, b: 2 }), t.syncFingerprint({ b: 2, a: 1 }));
  eq("同期 中身が違えば指紋も違う",
     t.syncFingerprint({ a: 1 }) !== t.syncFingerprint({ a: 2 }), true);
}

// ── 進捗マップの状態 ───────────────────────────────────
{
  // v8.56で3つに絞った。緑=実施済 / 赤=未実施 / 灰=対象外。
  // 中間(調合済・未送信)は色を持たせず、実施済・未実施のどちらかに寄せる。
  const keys = ["done", "planned", "none"];
  keys.forEach(k => {
    eq("進捗 " + k + " に色がある", !!(t.PROGRESS_STATES[k] || {}).fill, true);
    eq("進捗 " + k + " に見出しがある", !!(t.PROGRESS_STATES[k] || {}).label, true);
  });
  eq("進捗 色は3つだけ", Object.keys(t.PROGRESS_STATES).length, 3);
  eq("進捗 凡例の並びは色の数と一致", t.PROGRESS_ORDER.length, 3);
  // 同じ圃場に複数の作業があるとき、いちばん進んだ状態を採るための順序
  eq("進捗 実施済が最上位", t.PROGRESS_RANK.done > t.PROGRESS_RANK.planned, true);
  eq("進捗 対象外が最下位", t.PROGRESS_RANK.planned > t.PROGRESS_RANK.none, true);
  // サーバーから来る状態(planned / mixed / done)と、旧版の local を寄せる
  eq("進捗 done は実施済", t.toMapStatus("done"), "done");
  eq("進捗 local(未送信)は実施済", t.toMapStatus("local"), "done");
  eq("進捗 mixed(調合済)は未実施", t.toMapStatus("mixed"), "planned");
  eq("進捗 planned は未実施", t.toMapStatus("planned"), "planned");
  eq("進捗 知らない状態は未実施に倒す", t.toMapStatus("なにか"), "planned");
}

// ── 作業のIDは「日付＋圃場ID」から決まる ────────────────
// 端末ごとに採番していた頃は、AとBが同じ日に同じ圃場を登録すると
// 同期後に2行に増えていた。同じ入力から必ず同じIDが出ることを見る。
{
  const A = t.workIdFor("2026-08-27", 1001, 1);
  const B = t.workIdFor("2026-08-27", 1001, 1);
  eq("作業ID 同じ日・同じ圃場なら同じID", A, B);
  eq("作業ID 日が違えば別のID", t.workIdFor("2026-08-28", 1001, 1) !== A, true);
  eq("作業ID 圃場が違えば別のID", t.workIdFor("2026-08-27", 1002, 1) !== A, true);
  eq("作業ID 2枚目は別のID", t.workIdFor("2026-08-27", 1001, 2) !== A, true);
  eq("作業ID 数値で返る", typeof A, "number");
  eq("作業ID 安全な整数の範囲", Number.isSafeInteger(A) && A > 0, true);
  // 数千件規模で衝突しないことを実際に見る
  {
    const seen = new Set();
    let dup = 0;
    for (let d = 1; d <= 60; d++) {
      const day = "2026-" + String(1 + (d % 12)).padStart(2, "0") + "-" + String(1 + (d % 28)).padStart(2, "0");
      for (let f = 1; f <= 200; f++) {
        const id = t.workIdFor(day, 1700000000000 + f, 1);
        if (seen.has(id)) dup++;
        seen.add(id);
      }
    }
    eq("作業ID 12000件作っても衝突なし", dup, 0);
  }
  // ── 2件目以降だけ端末で分ける(v8.86) ──
  // nth は「この端末が持っている作業」だけを見て空き番号を探すので、
  // 別々の端末が同時に2件目を作るとどちらも nth=2 になり、同じIDになっていた。
  // 台帳は「チーム＋ID」で上書きするため、後から送ったほうが相手の2件目を消す。
  eq("作業ID 1件目は端末が違っても同じ(合流させる設計)",
    t.workIdFor("2026-08-27", 1001, 1, "dev-A"), t.workIdFor("2026-08-27", 1001, 1, "dev-B"));
  eq("作業ID 2件目は端末が違えば別のID",
    t.workIdFor("2026-08-27", 1001, 2, "dev-A") !== t.workIdFor("2026-08-27", 1001, 2, "dev-B"), true);
  eq("作業ID 2件目は同じ端末なら同じID(入れ直しても変わらない)",
    t.workIdFor("2026-08-27", 1001, 2, "dev-A"), t.workIdFor("2026-08-27", 1001, 2, "dev-A"));
  eq("作業ID 3件目も端末で分かれる",
    t.workIdFor("2026-08-27", 1001, 3, "dev-A") !== t.workIdFor("2026-08-27", 1001, 3, "dev-B"), true);
  eq("作業ID 2件目と3件目は同じ端末でも別のID",
    t.workIdFor("2026-08-27", 1001, 2, "dev-A") !== t.workIdFor("2026-08-27", 1001, 3, "dev-A"), true);
  // 端末IDを渡さない呼び方は v8.85 までと同じ値を返す(既存データの読み替えが不要)
  eq("作業ID 端末IDなしの1件目は従来どおり", t.workIdFor("2026-08-27", 1001, 1, ""), A);
  eq("作業ID 端末IDなしの2件目は従来どおり",
    t.workIdFor("2026-08-27", 1001, 2, ""), t.workIdFor("2026-08-27", 1001, 2));
}

// ── makeWork が端末IDを混ぜて呼んでいるか(ソースの形) ──
// workIdFor 側だけ直しても、呼び出しが3引数のままなら効かない。
{
  eq("makeWork は端末IDを渡している",
    /workIdFor\(workDate, f\.id, (1|nth), deviceId\)/.test(src), true);
  eq("端末IDを渡さない workIdFor の呼び出しが残っていない",
    /workIdFor\(workDate, f\.id, (1|nth)\)/.test(src), false);
}

// ── 作業を消す道は、必ず墓標を積んで送る ───────────
// 墓標(tombstone)を積まないと、シート側の行が残る。残ると進捗地図は
// その圃場を未実施(赤)のまま出し続け、対象外(黄)に戻らない。
// v8.71 の removeWorks がこれを抜かしていて、「外す」だと消えるのに
// 「🗑 選択して削除」だと消えない、という差になっていた。
// これらは App() の中にあるので値としては取り出せない。原文で確かめる。
{
  const body = name => {
    const head = src.indexOf("const " + name + " = ");
    if (head < 0) return null;
    // 関数の終わりは、同じ字下がりの "  };" まで
    const end = src.indexOf("\n  };", head);
    return end < 0 ? null : src.slice(head, end);
  };
  ["removeWork", "removeWorks", "deleteWork"].forEach(name => {
    const b = body(name);
    eq("削除 " + name + " が見つかる", b !== null, true);
    if (!b) return;
    eq("削除 " + name + " が墓標を積む", /addTomb\("works"/.test(b), true);
    eq("削除 " + name + " が進捗を送る", /pushProgress\(/.test(b), true);
  });
}

// ── v8.78 で直した3件が戻っていないか ──────────────
// いずれも App() の中のクロージャなので値を取り出せない。
// 形だけを見る。形の検査は弱いが、全消しに戻したときには落ちる。
{
  eq("墓標を全消ししていない", /t\.(works|fields|chems) = \[\];/.test(src), false);
  eq("墓標は送った分だけ引く", (src.match(/sentIds\.has\(String\(x\.id\)\)/g) || []).length, 3);
  eq("墓標の送信分を拾う", (src.match(/const sentIds = new Set\(tombs\.map/g) || []).length, 3);

  // 受信の削除の枝にも編集日時の比較があるか
  const delBranches = src.split("if (inc.deleted) {").slice(1);
  eq("削除の枝は3か所", delBranches.length, 3);
  delBranches.forEach((b, i) => {
    const head = b.slice(0, 400);
    eq("削除の枝" + (i + 1) + " に編集日時の比較がある",
      /old && String\(old\.updatedAt \|\| ""\) > String\(inc\.updatedAt \|\| ""\)/.test(head), true);
  });

  // 実績メモを受信で空にしない
  eq("実績メモを保護している", /reportMemo: inc\.reportMemo \|\| old\.reportMemo/.test(src), true);

  // 固形剤の単位。転記は kg なので画面は g にする
  eq("剤型で単位を切り替えている",
    (src.match(/agriAmountUnit\(c\.form\) === "kg" \? " g" : " mL"/g) || []).length, 4);
  eq("剤型を見ない mL 直書きが残っていない",
    /fmt\(c\.ml\), " mL"/.test(src), false);
  // 結果表の small は fmt(c.ml) と離れた位置にあり、上の検査をすり抜けていた
  eq("結果表の単位も剤型で切り替わる",
    src.includes('}, agriAmountUnit(c.form) === "kg" ? " g" : " mL")))))), p.mixOrder'), true);
  eq("固形剤は kg 判定", t.agriAmountUnit("wg"), "kg");
  eq("乳剤は mL 判定", t.agriAmountUnit("ec"), "mL");

  // チームを変えたら pullat を捨てる
  eq("チーム変更で pullat を捨てる",
    /if \(prev !== v\.trim\(\)\) localStorage\.removeItem\("tankmix:pullat"\)/.test(src), true);
  eq("切替えの警告を出している", /teamCodeAtLoad !== p\.teamCode\.trim\(\)/.test(src), true);
}

// ── 進捗地図の吹き出しにナビがあるか ────────────────
{
  eq("吹き出しにナビを出している",
    src.includes('naviLink(fieldCenter(sel.field)'), true);
  eq("ナビの文言", src.includes("この圃場へナビ"), true);
  // 座標が無いときは a ではなく button になる(href=\"#\" で飛ばないため)
  eq("座標が無いときの逃げ道がある", /naviLink = \(center, style, label\) => center \?/.test(src), true);
}

// ── 無くなったタブ・ボタンを案内していないか(v8.82) ────
// v8.61 でデータベースタブをなくしたが、使い方ガイドと
// 圃場が0件のときの案内は古いタブ名のまま残っていた。
{
  eq("圃場が0件のときの案内が今のタブ",
    src.indexOf("「🗺圃場登録・圃場一覧」タブの地図で囲んで登録") > 0, true);
  eq("ガイドにデータベースタブの節が無い",
    src.indexOf('title: "📋 データベースタブ"'), -1);
  eq("ガイドの見出しが今のタブ名",
    src.indexOf("作業予定・進捗確認タブ(以下「作業タブ」)") > 0, true);
  eq("無いタブを指す案内が残っていない(1)",
    src.indexOf("「データベース」タブで行えます"), -1);
  eq("無いタブを指す案内が残っていない(2)",
    src.indexOf("「作業・記録」タブ"), -1);
  // 台帳の送信は日ごと。「全データ」というボタンは v8.63 以降無い。
  eq("古い送信ボタン名を案内していない",
    src.indexOf("「☁ 全データを送信」で送信が完了"), -1);
}

// ── 進捗地図の色は作業単位(v8.83) ──────────────
// v8.82までは圃場ごとに「状態の大きい方」を採っていたため、同じ日に
// 同じ圃場が2件あると、片方が未実施でも緑になっていた(実測で確認)。
{
  eq("作業IDで重ねている", src.includes("const byWork = new Map();"), true);
  eq("スナップショットの作業IDを渡している",
    src.includes("put(it.id, it.fieldId, {"), true);
  eq("手元の作業IDを渡している", src.includes("put(w.id, w.fieldId, {"), true);
  eq("1件でも未実施なら未実施",
    src.includes('v.status = v.doneCount === v.total ? "done" : "planned";'), true);
  eq("大きい方を採る古い判定が残っていない",
    src.indexOf("PROGRESS_RANK[st.status] > PROGRESS_RANK[cur.status]"), -1);
  eq("吹き出しの中身は実績のあるほうを優先",
    src.includes("if (r > cur.bestRank) {"), true);
  eq("bestRank は外に出さない", src.includes("delete v.bestRank;"), true);
  // 吹き出しは先頭固定ではなく、まだ済んでいない作業を先に取る
  eq("未実施を先に拾う",
    src.includes("swList.find(w => !w.reported) || swList[swList.length - 1]"), true);
  eq("先頭固定の find が残っていない",
    src.indexOf('const sw = (p.works || []).find(w => String(w.fieldId)'), -1);
  eq("2件以上のときは件数を出す",
    src.includes('"この日の作業 " + sel.st.total + "件（" + sel.st.doneCount + "件済）"'), true);
}

// ── 保存の失敗を黙らせない・CSVの単位(v8.84) ───────
// save() は v8.83 まで console.error だけで黙っていた。React の状態は
// 更新済みなので、画面には入ったように見えて次に開くと消えている。
{
  eq("保存失敗の受け口がある", src.includes("let saveFailHook = null;"), true);
  eq("上限を越えたときを見分けている",
    src.includes('e.name === "QuotaExceededError"') && src.includes("e.code === 22"), true);
  eq("失敗を画面へ渡している", src.includes("if (saveFailHook) saveFailHook(full"), true);
  eq("App が受け口を差し込む", src.includes("saveFailHook = msg => setSaveFail(msg);"), true);
  eq("帯は自分で閉じるまで残る", src.includes("onClick: () => setSaveFail(\"\"),"), true);
  // CSV は提出する記録。固形剤を mL と書くと、体積で量られる
  eq("CSV も剤型で単位を切り替える",
    src.includes('(agriAmountUnit(c.form) === "kg" ? "g" : "mL")'), true);
  eq("CSV に mL の直書きが残っていない",
    src.indexOf('Math.round(c.ml) : 0) + "mL)"'), -1);
}

// ── 受信マージの押しとどめ判定(v8.85) ────────────────
// GAS が pull の基準時刻を手前にずらすので、直近の行は毎回配り直される。
// 編集日時が進んでいないものを適用すると、保存と再描画が毎回走る。
{
  const k = t.keepLocalEdit;
  eq("同じ編集日時は適用しない",
    k("2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"), true);
  eq("手元のほうが新しければ適用しない",
    k("2026-08-02T00:00:00.000Z", "2026-08-01T00:00:00.000Z"), true);
  eq("受け取ったほうが新しければ適用する",
    k("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"), false);
  eq("手元に無い(空)なら適用する", k("", "2026-08-01T00:00:00.000Z"), false);
  eq("受け取った側に編集日時が無ければ適用しない",
    k("2026-08-01T00:00:00.000Z", ""), true);
  eq("両方とも空なら適用する(初期データを取りこぼさない)", k("", ""), false);
  eq("undefined も空として扱う", [k(undefined, undefined), k(undefined, "x")], [false, false]);
}

// ── 現在地の監視(v8.88) ──────────────────────────────
{
  const g = t.geoWatch;
  // 対応していない端末
  {
    let msg = null;
    const stop = g({}, () => {}, m => { msg = m; });
    eq("位置情報に対応していなければ知らせる", typeof msg === "string" && msg.length > 0, true);
    eq("止める関数は必ず返る", typeof stop, "function");
    stop(); // 落ちないこと
  }
  // 通常の監視
  {
    const calls = [];
    let cleared = null, watchId = 77, cb = null, errCb = null, opts = null;
    const nav = { geolocation: {
      watchPosition: (ok, ng, o) => { cb = ok; errCb = ng; opts = o; return watchId; },
      clearWatch: id => { cleared = id; },
    } };
    const stop = g(nav, pos => calls.push(pos), () => {});
    eq("高精度で測る", opts.enableHighAccuracy, true);
    eq("少し古い値も使う(最初の1点を待たせない)", opts.maximumAge > 0, true);
    cb({ coords: { latitude: 33, longitude: 130 } });
    cb({ coords: { latitude: 34, longitude: 131 } });
    eq("測るたびに呼ばれる", calls.length, 2);
    // 権限以外の失敗は続ける
    errCb({ code: 2 });
    errCb({ code: 3 });
    cb({ coords: { latitude: 35, longitude: 132 } });
    eq("測位失敗・時間切れでは止めない", [calls.length, cleared], [3, null]);
    stop();
    eq("止めると clearWatch する", cleared, watchId);
    cb({ coords: { latitude: 36, longitude: 133 } });
    eq("止めたあとは呼ばれない", calls.length, 3);
    cleared = null;
    stop();
    eq("二度止めても clearWatch は1回だけ", cleared, null);
  }
  // 権限を断られたら、その場で止めて一度だけ知らせる
  {
    const msgs = [];
    let cleared = null, errCb = null;
    const nav = { geolocation: {
      watchPosition: (ok, ng) => { errCb = ng; return 5; },
      clearWatch: id => { cleared = id; },
    } };
    g(nav, () => {}, m => msgs.push(m));
    errCb({ code: 1 });
    eq("権限を断られたら止める", cleared, 5);
    eq("知らせは1回", msgs.length, 1);
    errCb({ code: 1 });
    eq("止まったあとは何も知らせない", msgs.length, 1);
  }
}

// ── 進捗地図が現在地を出し続けるか(ソースの形) ────────
// 押したときだけ測る形に戻っていないか、後片付けを忘れていないかを見る。
// watch を止め忘れると、地図を閉じても測位が続いて電池を食う。
{
  const canvases = [
    ["ProgressLeafletCanvas", src.slice(src.indexOf("function ProgressLeafletCanvas"), src.indexOf("function ProgressGoogleCanvas"))],
    ["ProgressGoogleCanvas", src.slice(src.indexOf("function ProgressGoogleCanvas"), src.indexOf("function ProgressMapTab"))],
  ];
  canvases.forEach(([name, body]) => {
    eq(name + " は geoWatch で監視する", body.includes("geoWatch(navigator"), true);
    eq(name + " は止める関数を後片付けで呼ぶ", /geoStopRef\.current\(\)/.test(body), true);
    eq(name + " は精度の円も出す", body.includes("gpsAccRef"), true);
    // drawGps(印を描く)の中で地図を動かしていないこと。
    // 追いかけて中心を変えると、少し先の圃場を見ようとしても引き戻される。
    const a = body.indexOf("const drawGps = pos => {");
    const b = body.indexOf("const geoStopRef");
    eq(name + " の drawGps が見つかる", a > 0 && b > a, true);
    const draw = a > 0 && b > a ? body.slice(a, b) : "";
    eq(name + " は追従で地図を動かさない",
      // gpsAccRef(精度の円)の setCenter は地図ではないので、地図の変数 m に限る
      /m\.(setView|setCenter|setZoom)\(/.test(draw), false);
  });
}

// ── 全画面の操作ボタン(v8.93) ────────────────────────
// 上端(v8.89)も下端(v8.90〜8.92)も、実機では見出し・タブバーの裏に回った。
// 覆いより手前に描かれるものがあるため。上下を使わず、地図の右わきに置く。
{
  const tab = src.slice(src.indexOf("function ProgressMapTab"), src.indexOf("const S = {"));
  const seg = tab.slice(tab.indexOf("S.mapSideBtns"));
  eq("全画面のときに現在地ボタンを出す", seg.includes("apiRef.current.locate"), true);
  eq("全画面のボタンは fullMap のときだけ",
    /fullMap && [\s\S]{0,1600}S\.mapSideBtns/.test(tab), true);
  eq("全画面に札の切替もある", seg.includes("setShowLabels"), true);
  eq("全画面のボタンは4つ", (seg.match(/S\.mapSideBtn(?!s|Off|Warn)/g) || []).length, 4);

  // ── 画面の上下を使わない(v8.93) ──
  eq("上端にも下端にも貼り付けていない",
    /mapSideBtns: \{[\s\S]{0,600}(top: 0|bottom: 0|inset-top|inset-bottom)/.test(src), false);
  eq("縦は真ん中に置く",
    /mapSideBtns: \{[\s\S]{0,600}top: "50%"[\s\S]{0,120}transform: "translateY\(-50%\)"/.test(src), true);
  eq("覆いを基準にする(画面を基準にしない)",
    /mapSideBtns: \{[\s\S]{0,300}position: "absolute"/.test(src) &&
    !/mapSideBtns: \{[\s\S]{0,600}position: "fixed"/.test(src), true);
  eq("覆いは絶対配置の基準になる(position が付いている)",
    /mapWrapFull: \{[\s\S]{0,200}position: "fixed"/.test(src), true);
  eq("地図(zIndex 0 の入れ物)より前に出す",
    /mapSideBtns: \{[\s\S]{0,600}zIndex: 2/.test(src), true);
  eq("覆いの中に置く(外に出すと画面基準になる)",
    /style: fullMap \? S\.mapWrapFull : S\.mapWrap[\s\S]{0,3000}S\.mapSideBtns/.test(src), true);

  // ── 小さく、それでも押せる ──
  eq("指で押す的は44px角",
    /mapSideBtn: \{[\s\S]{0,300}width: 44,[\s\S]{0,40}height: 44/.test(src), true);
  // 絵文字だけなので、何のボタンかは title と読み上げ用の名前で補う
  eq("4つとも読み上げ用の名前がある",
    (seg.match(/"aria-label":/g) || []).length, 4);
  eq("4つとも title がある(seg には次の全画面ボタンの title も1つ入る)",
    (seg.match(/title:/g) || []).length >= 4, true);
  eq("札OFFのときの見た目がある", src.includes("mapSideBtnOff: {"), true);
  eq("使わなくなった帯の定義が残っていない", src.includes("mapFullBar"), false);
}

// ── 位置情報の案内(v8.94) ────────────────────────────
// 現在地が出ないときに画面へ何も出していなかった。断られたのか、測っている
// 途中なのか、端末が非対応なのかが分からず、直しようがなかった。
{
  const h = t.geoHintFor;
  eq("位置が出ていれば何も出さない", h("granted", true), null);
  eq("出ていれば、拒否の記録が残っていても出さない", h("denied", true), null);
  eq("まだ聞かれていなければ入口を出す", h("prompt", false).guide, false);
  eq("入口の文言", h("prompt", false).text.indexOf("位置情報を使う") >= 0, true);
  eq("状態が分からなくても入口を出す(押せば確認が出るかもしれない)",
    h("unknown", false).guide, false);
  eq("許可済みなのにまだ出ていないときも入口を出す(測位中・失敗)",
    h("granted", false) !== null, true);
  eq("拒否されていたら設定へ案内する(押しても確認は出ない)",
    h("denied", false).guide, true);
  eq("拒否の文言は警告", h("denied", false).text.indexOf("⚠") >= 0, true);
  eq("非対応も設定へ案内する側", h("unsupported", false).guide, true);
  eq("非対応の文言", h("unsupported", false).text.indexOf("対応していません") >= 0, true);
}

// ── 位置情報の案内が画面まで届いているか(ソースの形) ──
{
  const tab = src.slice(src.indexOf("function ProgressMapTab"), src.indexOf("const S = {"));
  eq("権限の状態を読む", tab.includes('name: "geolocation"'), true);
  eq("設定で許可し直したときに気づく(onchange)", /x\.onchange = \(\) =>/.test(tab), true);
  eq("押したときに測る(操作の直後でないと確認を出さない端末がある)",
    /askGeo = \(\) => \{[\s\S]{0,1200}getCurrentPosition/.test(tab), true);
  eq("拒否済みなら測らずに設定へ案内する",
    /geoState === "denied"[\s\S]{0,400}return;/.test(tab), true);
  eq("許可が取れたら測位をやり直す",
    /setGeoState\("granted"\);[\s\S]{0,200}setGeoAttempt\(n => n \+ 1\)/.test(tab), true);
  eq("案内はツールバーに出す", tab.includes("geoHint && ") && tab.includes("S.geoHintBtn"), true);
  eq("全画面の📍も、出ていなければ許可を求める側に回る",
    /if \(geoHint\) \{[\s\S]{0,80}askGeo\(\);/.test(tab), true);
  eq("キャンバスへ渡している",
    /geoAttempt,/.test(tab) && /onGeoFix: \(\) => setGeoFix\(true\)/.test(tab), true);

  const canvases = [
    src.slice(src.indexOf("function ProgressLeafletCanvas"), src.indexOf("function ProgressGoogleCanvas")),
    src.slice(src.indexOf("function ProgressGoogleCanvas"), src.indexOf("function ProgressMapTab")),
  ];
  canvases.forEach((body, i) => {
    const name = i === 0 ? "Leaflet" : "Google";
    eq(name + " は geoAttempt で測位をやり直す",
      /\}, \[ready, p\.geoAttempt\]\);/.test(body), true);
    eq(name + " は位置が取れたことを親に伝える", body.includes("p.onGeoFix && p.onGeoFix()"), true);
  });
}

// ── 差分描画の署名(v8.91) ────────────────────────────
// ここに入れ忘れたものは「サーバーには届いているのに地図が変わらない」
// という形で出る。利用者からは共有が壊れたのと見分けが付かない。
{
  const sig = t.fieldDrawSig;
  const F = { id: 1, name: "北の田", areaA: 12.5, updatedAt: "2026-08-01T00:00:00.000Z",
              polygon: [[33,130],[33,131],[34,131]] };
  const ST = { status: "planned", by: "藤本", at: "2026-08-20", sprayedL: 0, areaA: 12.5, pending: false };
  const base = sig(F, ST, true, "a");

  eq("同じ材料なら同じ署名", sig(F, ST, true, "a"), base);
  // 色が変わるもの
  eq("状態が変われば変わる", sig(F, { ...ST, status: "done" }, true, "a") !== base, true);
  eq("作業から外れれば変わる(対象外へ)", sig(F, null, true, "a") !== base, true);
  // 色は変えないが吹き出しに出るもの。落とすと吹き出しだけ古くなる
  eq("実散布量が変われば変わる", sig(F, { ...ST, sprayedL: 95 }, true, "a") !== base, true);
  eq("記録者が変われば変わる", sig(F, { ...ST, by: "田中" }, true, "a") !== base, true);
  eq("入力日が変われば変わる", sig(F, { ...ST, at: "2026-08-21" }, true, "a") !== base, true);
  eq("報告面積が変われば変わる", sig(F, { ...ST, areaA: 11 }, true, "a") !== base, true);
  eq("未送信の印が変われば変わる", sig(F, { ...ST, pending: true }, true, "a") !== base, true);
  // 札まわり
  eq("札の出し分けが変われば変わる", sig(F, ST, false, "a") !== base, true);
  eq("面積の単位が変われば変わる", sig(F, ST, true, "ha") !== base, true);
  eq("圃場名が変われば変わる", sig({ ...F, name: "南の田" }, ST, true, "a") !== base, true);
  eq("面積が変われば変わる", sig({ ...F, areaA: 20 }, ST, true, "a") !== base, true);
  // 形
  eq("囲み直せば変わる(編集時刻)",
    sig({ ...F, updatedAt: "2026-08-02T00:00:00.000Z" }, ST, true, "a") !== base, true);
  eq("頂点の数が変われば変わる(編集時刻が無い古いデータ向け)",
    sig({ ...F, updatedAt: "", polygon: [[33,130],[33,131],[34,131],[34,130]] }, null, true, "a") !==
    sig({ ...F, updatedAt: "", polygon: [[33,130],[33,131],[34,131]] }, null, true, "a"), true);
  // 区切りの取り違えが起きないこと(隣の項目へ食い込まない)
  eq("項目の境目が混ざらない",
    sig({ ...F, name: "あ", areaA: "" }, null, true, "a") !==
    sig({ ...F, name: "", areaA: "あ" }, null, true, "a"), true);
}

// ── 差分の出し方(v8.91) ──────────────────────────────
{
  const d = t.diffDraw;
  const m = o => new Map(Object.entries(o));
  eq("何も変わっていなければ何もしない",
    d(m({ a: "1", b: "2" }), m({ a: "1", b: "2" })), { draw: [], drop: [] });
  eq("増えたものは作る",
    d(m({ a: "1" }), m({ a: "1", b: "2" })), { draw: ["b"], drop: [] });
  eq("消えたものは消す",
    d(m({ a: "1", b: "2" }), m({ a: "1" })), { draw: [], drop: ["b"] });
  eq("変わったものは消してから作り直す",
    d(m({ a: "1" }), m({ a: "9" })), { draw: ["a"], drop: ["a"] });
  eq("初回は全部作る", d(new Map(), m({ a: "1", b: "2" })), { draw: ["a", "b"], drop: [] });
  eq("全部消えたら全部消す", d(m({ a: "1", b: "2" }), new Map()), { draw: [], drop: ["a", "b"] });
}

// ── 差分描画が両方の地図に入っているか(ソースの形) ────
// 全消しに戻ると、45秒ごとに全部作り直す元の重さに戻る。
// 逆に記憶の捨て忘れがあると、地図を作り直したとき空のままになる。
{
  const L = src.slice(src.indexOf("function ProgressLeafletCanvas"), src.indexOf("function ProgressGoogleCanvas"));
  const G = src.slice(src.indexOf("function ProgressGoogleCanvas"), src.indexOf("function ProgressMapTab"));
  [["Leaflet", L], ["Google", G]].forEach(([name, body]) => {
    eq(name + " は署名で比べる", body.includes("fieldDrawSig(f, st, showLabel, p.areaUnitKey)"), true);
    eq(name + " は差分を取る", body.includes("diffDraw(prevSig, nextSig)"), true);
    eq(name + " は消すぶんと作るぶんを分けて当てる",
      body.includes("d.drop.forEach") && body.includes("d.draw.forEach"), true);
    eq(name + " は地図を作り直したら記憶を捨てる",
      (body.match(/drawnRef\.current = new Map\(\)/g) || []).length >= 2, true);
  });
  // 描画の effect の中で全消ししていないこと
  const drawEffectOf = body => {
    const i = body.indexOf("const showLabel = labelsVisible");
    const j = body.indexOf("fitRef.current = targetBounds;", i);
    return i > 0 && j > i ? body.slice(i, j) : "";
  };
  eq("Leaflet は描き直しで全消ししない", /clearLayers\(\)/.test(drawEffectOf(L)), false);
  eq("Google は描き直しで全消ししない", /overlaysRef/.test(drawEffectOf(G)), false);
  eq("Google の重ね物は圃場ごとにまとめている", G.includes("cur.overlays.forEach"), true);
  eq("使わなくなった overlaysRef が残っていない", src.includes("overlaysRef"), false);
}

// ── 札(圃場名・面積)の出し分け(v8.89) ────────────────
// 札は圃場1枚につきDOMを1つ(Leaflet)ないし2つ(Google)作り、パン・ズームの
// たびに全部の位置が計算し直される。倍率だけでは、寄った状態で圃場が密な
// ときに逃げ道がないので、手で消せるようにした。
{
  const v = t.labelsVisible, Z = t.PROGRESS_LABEL_MIN_ZOOM;
  eq("しきい値は15", Z, 15);
  eq("ONかつ倍率が足りていれば出す", v(true, Z), true);
  eq("ONでも倍率が足りなければ出さない", v(true, Z - 1), false);
  eq("OFFなら倍率が足りていても出さない", v(false, Z + 5), false);
  eq("未設定(undefined)は従来どおり出す", v(undefined, Z), true);
  eq("未設定でも倍率が足りなければ出さない", v(undefined, Z - 1), false);
}

// ── 札の切替が地図まで届いているか(ソースの形) ────────
{
  const tab = src.slice(src.indexOf("function ProgressMapTab"), src.indexOf("const S = {"));
  eq("端末に残す", tab.includes('"tankmix:proglabels"'), true);
  eq("既定は出す(更新で急に消えない)", tab.includes('!== "0"'), true);
  eq("キャンバスへ渡している", /showLabels,/.test(tab), true);
  // 上のツールバーにも、全画面の帯にも切替がある(押す場所が1か所だと、
  // 全画面をやめてから戻る手間になる)
  eq("ツールバーにも切替がある",
    tab.indexOf("setShowLabels") < tab.indexOf("S.mapSideBtns"), true);
  eq("切替は2か所ある", (tab.match(/setShowLabels\(!showLabels\)/g) || []).length, 2);
  const canvases = [
    src.slice(src.indexOf("function ProgressLeafletCanvas"), src.indexOf("function ProgressGoogleCanvas")),
    src.slice(src.indexOf("function ProgressGoogleCanvas"), src.indexOf("function ProgressMapTab")),
  ];
  canvases.forEach((body, i) => {
    const name = i === 0 ? "Leaflet" : "Google";
    eq(name + " が labelsVisible で判定する",
      body.includes("labelsVisible(p.showLabels, zoom)"), true);
    eq(name + " の描き直しの条件にも入っている",
      /\}, \[ready, p\.fields, p\.statusByField, labelsVisible\(p\.showLabels, zoom\)/.test(body), true);
    eq(name + " に倍率だけの判定が残っていない",
      /showLabel = zoom >= PROGRESS_LABEL_MIN_ZOOM/.test(body), false);
  });
}

// ── 共有オフ→オンの順序(v8.87) ───────────────────────
// auto* は debounce の有無が揃っておらず(押し込みは1.5秒、受け取りは即座)、
// 並べて呼ぶと受け取りが先に走る。効果の中身を取り出して順番を見る。
{
  const m = src.match(/const shareOnFirstRef[\s\S]*?\n  \}, \[shareOn\]\);/);
  eq("shareOn の効果が見つかる", !!m, true);
  const body = m ? m[0] : "";
  const at = name => body.indexOf(name);
  eq("送信3種と受信がこの順で並んでいる",
    at("pushFieldsSync") > 0 &&
    at("pushFieldsSync") < at("pushChemsSync") &&
    at("pushChemsSync") < at("pushProgress") &&
    at("pushProgress") < at("pullSharedSync"), true);
  eq("4つとも await している",
    (body.match(/await (pushFieldsSync|pushChemsSync|pushProgress|pullSharedSync)\(/g) || []).length, 4);
  eq("debounce 付きの auto* を使っていない",
    /auto(PushFields|PushChems|PushWorks|PullShared)\(/.test(body), false);
  eq("途中で打ち切れる(オフに戻したときに送信を飛ばさない)",
    body.includes("alive = false") && body.includes("if (!alive) return;"), true);
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
