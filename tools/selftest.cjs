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
// 改行は LF に揃えてから見る。
// このファイルには「app.js にこの並びで書かれているか」を文字列で見る検査が
// いくつもある。Windows で git checkout すると CRLF に変換されるため、
// 揃えずに比べると「中身は正しいのにテストだけ落ちる」ことになる。
// 実際に v9.06 のあと git checkout しただけで2件落ちた。
const nl = t => t.split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
const src = nl(fs.readFileSync(APP, "utf8"));

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
  "PROGRESS_ORDER", "PROGRESS_CARRY_DAYS", "toMapStatus", "workIdFor", "foldProgress", "progressEntries", "serverOrphans", "progressMapDiff", "PROGRESS_DIFF_KEY", "daysBefore", "carryOverFieldIds", "pickWorkOfDay", "workBy", "outgoingBy", "labelByText", "labelSizeOf", "fieldLabelVisible", "LABEL_SIZE_BREAKS", "LABEL_FONT", "textEmWidth", "labelBoxOf", "fieldLabelBox", "thinLabels", "labelPriOf", "summarizeByRecorder", "keepLocalEdit", "geoWatch", "labelsVisible", "PROGRESS_LABEL_MIN_ZOOM", "FIELD_LABEL_MIN_ZOOM", "fieldDrawSig", "diffDraw", "geoHintFor",
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
  // v8.56で3つに絞り、v8.95 で「前日までに済」を足して4つ。
  // 緑=今日やって済 / 赤=今日やる / 青=前の日に済 / 黄=対象外。
  // 中間(調合済・未送信)は色を持たせず、実施済・未実施のどちらかに寄せる。
  const keys = ["done", "planned", "donePrev", "none"];
  keys.forEach(k => {
    eq("進捗 " + k + " に色がある", !!(t.PROGRESS_STATES[k] || {}).fill, true);
    eq("進捗 " + k + " に見出しがある", !!(t.PROGRESS_STATES[k] || {}).label, true);
  });
  eq("進捗 色は4つだけ", Object.keys(t.PROGRESS_STATES).length, 4);
  eq("進捗 凡例の並びは色の数と一致", t.PROGRESS_ORDER.length, 4);
  // 4色が互いに違う色であること。衛星写真の上で見違えると意味がない
  {
    const fills = keys.map(k => t.PROGRESS_STATES[k].fill);
    eq("進捗 4色とも別の色", new Set(fills).size, 4);
  }
  // 同じ圃場に複数の作業があるとき、いちばん進んだ状態を採るための順序
  eq("進捗 実施済が最上位", t.PROGRESS_RANK.done > t.PROGRESS_RANK.planned, true);
  eq("進捗 今日の未実施は前日の済より上(今日やることを優先して見せる)",
    t.PROGRESS_RANK.planned > t.PROGRESS_RANK.donePrev, true);
  eq("進捗 対象外が最下位", t.PROGRESS_RANK.donePrev > t.PROGRESS_RANK.none, true);
  eq("さかのぼる日数は2日(今日と前日)", t.PROGRESS_CARRY_DAYS, 2);
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
    src.includes("put(it.id, it.fieldId, it.workDate, {"), true);
  eq("手元の作業IDを渡している", src.includes("put(w.id, w.fieldId, w.workDate, {"), true);
  // 畳む処理は v8.95 で foldProgress に切り出した(単体で検査できるように)
  // v9.03 で progressEntries に出した。畳むのは引き続き foldProgress

// ── 進捗地図の土台づくり(v9.03 で関数に出した) ──
// progress の結果と、pull で受け取った作業を重ねる。作業IDで畳み、手元が勝つ。
{
  const E = t.progressEntries;
  const item = o => Object.assign({ id: 1, fieldId: 7, workDate: "2026-08-31",
    status: "planned", by: "", at: "", atTime: "", sprayedL: 0, areaA: "" }, o);
  const work = o => Object.assign({ id: 1, fieldId: 7, workDate: "2026-08-31",
    reported: false, by: "", reportDate: "", reportAt: "", sprayedL: 0,
    reportAreaA: "", updatedAt: "", pushedAt: "" }, o);

  eq("何も無ければ空", E([], [], "2026-08-30", "2026-08-31", "私"), []);
  // 同じ作業IDなら1件に畳む。手元が後なので手元が勝つ
  {
    const r = E([item({ status: "done", by: "サーバー" })],
      [work({ reported: false, by: "手元" })], "2026-08-30", "2026-08-31", "私");
    eq("同じ作業IDは1件に畳む", r.length, 1);
    eq("手元が勝つ(散布済を外した直後は手元が正しい)", [r[0].status, r[0].by], ["planned", "手元"]);
  }
  // 作業IDが違えば別の件として残る
  eq("違う作業は別の件",
    E([item({ id: 1 })], [work({ id: 2 })], "2026-08-30", "2026-08-31", "私").length, 2);
  // 古い Code.gs は作業IDを返さない。畳めないので二重に数えるが、落ちない
  eq("作業IDが無くても落ちない",
    E([item({ id: "" }), item({ id: "" })], [], "2026-08-30", "2026-08-31", "私").length, 2);
  // 圃場IDは文字列に揃える。揃えないと同じ圃場が2件に割れる
  eq("圃場IDは文字列にする",
    E([item({ fieldId: 7 })], [], "2026-08-30", "2026-08-31", "私")[0].fieldKey, "7");
  // 範囲の外の作業は入れない
  eq("範囲の外は入れない",
    E([], [work({ workDate: "2026-08-01" })], "2026-08-30", "2026-08-31", "私"), []);
  // サーバー由来にも同じ範囲を掛ける(v9.08)。
  // items は端末に保存した写しから来ることがあり、
  // 範囲を狭めたあと(v9.01 で 3日 → 2日)や作業日を切り替えた直後は
  // 範囲の外の日が混ざる。入れてしまうと、古い日が「前の日に済んだ(青)」
  // として地図に残る。実データで 9圓場分拾った
  eq("サーバー由来も範囲の外は入れない",
    E([item({ workDate: "2026-08-29", status: "done" })], [], "2026-08-30", "2026-08-31", "私"), []);
  eq("範囲の内なら入れる",
    E([item({ workDate: "2026-08-30", status: "done" })], [], "2026-08-30", "2026-08-31", "私").length, 1);
  eq("日付が無いサーバー由来は入れない",
    E([item({ workDate: "" })], [], "2026-08-30", "2026-08-31", "私"), []);
  // 青(前の日に済)は範囲の内側だけで決まること
  {
    const f = t.foldProgress;
    const outside = f(E([item({ workDate: "2026-08-29", status: "done" })], [],
      "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    eq("範囲の外の済で青くならない", outside.size, 0);
    const inside = f(E([item({ workDate: "2026-08-30", status: "done" })], [],
      "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    eq("範囲の内の済は青くなる",
      [inside.size, inside.get("7").status, inside.get("7").prevDate],
      [1, "donePrev", "2026-08-30"]);
  }
  eq("日付が無い作業は入れない",
    E([], [work({ workDate: "" })], "2026-08-30", "2026-08-31", "私"), []);
  // サーバーの状態は toMapStatus を通す(mixed は planned 扱い)
  eq("mixed は未実施として見る",
    E([item({ status: "mixed" })], [], "2026-08-30", "2026-08-31", "私")[0].status, "planned");
  // 未送信の印
  eq("送っていない実績には印を付ける",
    E([], [work({ reported: true, updatedAt: "b", pushedAt: "a" })], "2026-08-30", "2026-08-31", "私")[0].pending, true);
  eq("送り済みなら印は付かない",
    E([], [work({ reported: true, updatedAt: "a", pushedAt: "a" })], "2026-08-30", "2026-08-31", "私")[0].pending, false);
  eq("サーバー由来には印を付けない",
    E([item({ status: "done" })], [], "2026-08-30", "2026-08-31", "私")[0].pending, false);

  // ── 提案A: progress を外せるかの照合 ──
  // items を空にすると「pull で受け取った作業だけ」で作れる。
  // 同じものが出るなら progress は要らない。
  {
    const f = t.foldProgress;
    const w = work({ reported: true, by: "田中", reportDate: "2026-08-31",
      reportAt: "2026-08-31T02:00:00.000Z", sprayedL: 300, reportAreaA: 12,
      updatedAt: "a", pushedAt: "a" });
    // サーバーが同じ内容を返している場合(pull が届いていれば必ずこうなる)
    const both = f(E([item({ status: "done", by: "田中", at: "2026-08-31",
      atTime: "2026-08-31T02:00:00.000Z", sprayedL: 300, areaA: 12 })], [w],
      "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    const only = f(E([], [w], "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    eq("同じ内容なら差分は出ない", t.progressMapDiff(both, only), []);
  }
  {
    const f = t.foldProgress, D = t.progressMapDiff;
    const a = f(E([item({ status: "done", by: "田中" })], [], "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    const b = f(E([], [], "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    eq("progress にしか無ければ気づく", D(a, b), [{ field: "7", why: "progressだけにある" }]);
    eq("pull にしか無ければ気づく", D(b, a), [{ field: "7", why: "pullだけにある" }]);
  }
  {
    const f = t.foldProgress, D = t.progressMapDiff;
    const a = f(E([], [work({ reported: true, by: "田中", updatedAt: "a", pushedAt: "a" })], "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    const b = f(E([], [work({ reported: true, by: "藤本", updatedAt: "a", pushedAt: "a" })], "2026-08-30", "2026-08-31", "私"), "2026-08-31");
    const d = D(a, b);
    eq("名前が違えば気づく", [d.length, (d[0] || {}).why, (d[0] || {}).a, (d[0] || {}).b], [1, "by", "田中", "藤本"]);
  }
  eq("空同士なら差分なし", t.progressMapDiff(new Map(), new Map()), []);
  eq("片方が無くても落ちない", t.progressMapDiff(null, null), []);

  // 配線。地図はこれまでどおり progress を土台にしている(まだ外していない)
  eq("地図は progress を土台にしたまま",
    src.includes("progressEntries(snap.items, p.works, fetchFrom, fetchTo, p.recorder),"), true);
  eq("裏で works だけの結果も作る",
    src.includes("progressEntries([], p.works, fetchFrom, fetchTo, p.recorder),"), true);
  eq("照合の結果を残す", src.includes("save(PROGRESS_DIFF_KEY, next);"), true);
  eq("設定タブに出す", src.includes("progressDiffLine()"), true);
}

  eq("畳む処理は foldProgress に任せる",
    src.includes("return Array.from(byWork.values());") &&
    src.includes("progressEntries(snap.items, p.works, fetchFrom, fetchTo, p.recorder),"), true);
  eq("1件でも未実施なら未実施",
    src.includes('v.status = v.doneCount === v.total ? "done" : "planned";'), true);
  eq("大きい方を採る古い判定が残っていない",
    src.indexOf("PROGRESS_RANK[st.status] > PROGRESS_RANK[cur.status]"), -1);
  eq("吹き出しの中身は実績のあるほうを優先", src.includes("r > cur._rank ||"), true);
  eq("内部の順位は外に出さない", src.includes("delete v._rank;"), true);
  eq("比較用の刻も外に出さない", src.includes("delete v._at;"), true);
  // 取得範囲は選んでいる日を含めた直近3日(Code.gs は元から範囲に対応している)
  eq("取得範囲をさかのぼる",
    src.includes("daysBefore(p.workDate, PROGRESS_CARRY_DAYS - 1)"), true);
  eq("1日に固定する書き方が残っていない",
    src.indexOf("const from = p.workDate;"), -1);
  // 吹き出しが選ぶ作業は pickWorkOfDay に切り出した(v8.96)。
  // ここを取得範囲(3日)で絞ってしまい、現場で使えなくなった。
  eq("未実施を先に拾う",
    src.includes("list.find(w => !w.reported) || list[list.length - 1]"), true);
  eq("先頭固定の find が残っていない",
    src.indexOf('const sw = (p.works || []).find(w => String(w.fieldId)'), -1);
  eq("吹き出しは pickWorkOfDay で選ぶ",
    (src.match(/pickWorkOfDay\(p\.works, sel\.field\.id, p\.workDate\)/g) || []).length, 3);
  eq("取得範囲で絞る書き方が残っていない",
    src.indexOf("w.workDate === from"), -1);
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
  eq("前日に済ませた日付も署名に入る", t.fieldDrawSig(
      { id: 1, name: "北", areaA: 1, updatedAt: "x", polygon: [] },
      { status: "donePrev", prevDate: "2026-08-28" }, true, "a") !==
    t.fieldDrawSig(
      { id: 1, name: "北", areaA: 1, updatedAt: "x", polygon: [] },
      { status: "donePrev", prevDate: "2026-08-27" }, true, "a"), true);
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

// ── 日付をさかのぼる(v8.95) ──────────────────────────
{
  const d = t.daysBefore;
  eq("0日前は同じ日", d("2026-08-29", 0), "2026-08-29");
  eq("2日前", d("2026-08-29", 2), "2026-08-27");
  eq("月をまたぐ", d("2026-09-01", 2), "2026-08-30");
  eq("年をまたぐ", d("2026-01-01", 2), "2025-12-30");
  eq("うるう年の2月29日", d("2024-03-01", 1), "2024-02-29");
  eq("うるう年でない年の3月1日", d("2026-03-01", 1), "2026-02-28");
  eq("形が違うものはそのまま返す", d("", 2), "");
  eq("壊れた日付もそのまま返す(落とさない)", d("2026-8-1", 2), "2026-8-1");
}

// ── 圃場ごとの色を決める(v8.95) ──────────────────────
// 170圃場を数日かけて回るとき、前の日に済ませた圃場が対象外(黄)のままだと
// 今日やる赤と区別が付かず、済んだ場所へまた向かうことになる。
{
  const f = t.foldProgress;
  const E = (fieldKey, workDate, status, extra) => Object.assign(
    { fieldKey, workDate, status, by: "藤本", at: workDate, sprayedL: 10, areaA: 12, pending: false },
    extra || {});
  const day = "2026-08-29";
  const st = (m, k) => (m.get(String(k)) || {}).status;

  // 今日ぶん(v8.83 の規則は変えない)
  {
    const m = f([E(1, day, "done")], day);
    eq("今日やって済なら実施済", st(m, 1), "done");
  }
  {
    const m = f([E(1, day, "planned")], day);
    eq("今日の未実施は未実施", st(m, 1), "planned");
  }
  {
    const m = f([E(1, day, "done"), E(1, day, "planned")], day);
    eq("同じ日に2件あって片方が未実施なら未実施", st(m, 1), "planned");
    eq("件数も出す", [m.get("1").total, m.get("1").doneCount], [2, 1]);
  }
  // 前の日ぶん
  {
    const m = f([E(1, "2026-08-28", "done")], day);
    eq("今日の予定に無く前日に済なら青", st(m, 1), "donePrev");
    eq("いつ済んだかを出す", m.get("1").prevDate, "2026-08-28");
    eq("吹き出しの入力日はその日にする", m.get("1").at, "2026-08-28");
    // 青の圃場でも札に名前を出す(v8.97)。出ないと青だけ名無しになる
    eq("前日に済ませた人の名前も出す", m.get("1").by, "藤本");
  }
  {
    const m = f([
      E(1, "2026-08-27", "done", { by: "古い人" }),
      E(1, "2026-08-28", "done", { by: "新しい人" })
    ], day);
    eq("何日か済んでいたら新しい日の人を出す", m.get("1").by, "新しい人");
  }
  {
    const m = f([E(1, "2026-08-28", "done", { by: "" })], day);
    eq("名前が無い前日分でも落ちない", m.get("1").by, "");
  }
  {
    const m = f([
      E(1, "2026-08-28", "done", { by: "前日の人" }),
      E(1, day, "done", { by: "今日の人" })
    ], day);
    eq("今日の実績があれば今日の人を出す", m.get("1").by, "今日の人");
  }
  {
    const m = f([E(1, "2026-08-27", "done"), E(1, "2026-08-28", "done")], day);
    eq("何日か済んでいたら新しいほうを出す", m.get("1").prevDate, "2026-08-28");
  }
  {
    const m = f([E(1, "2026-08-28", "planned")], day);
    eq("前日の未実施は地図に出さない(今日の予定ではない)", m.has("1"), false);
  }
  // 今日と前日が両方ある = 引き継いだ圃場
  {
    const m = f([E(1, "2026-08-28", "done"), E(1, day, "planned")], day);
    eq("引き継いだ圃場は今日の状態が勝つ(赤)", st(m, 1), "planned");
  }
  {
    const m = f([E(1, "2026-08-28", "planned"), E(1, day, "done")], day);
    eq("前日やり残して今日済ませたら緑", st(m, 1), "done");
  }
  // 出さないもの
  {
    const m = f([], day);
    eq("何も無ければ空", m.size, 0);
  }
  {
    const m = f([E(9, "2026-08-20", "done")], day);
    eq("範囲外は呼び側が渡さない前提だが、渡されれば青になる", st(m, 9), "donePrev");
  }
  // 未送信の印
  {
    const m = f([E(1, day, "done", { pending: true })], day);
    eq("未送信の印は今日ぶんだけ拾う", m.get("1").pending, true);
  }
  {
    const m = f([E(1, "2026-08-28", "done", { pending: true })], day);
    eq("前日ぶんの未送信は今日の印にしない", m.get("1").pending, false);
  }
  // 重複して済ませたとき、最後に済ませた人を採る(v8.98)
  // 2チームで回っていて同じ圃場を二重に済ませることがある。
  // 受信の順で名前が入れ替わると、見るたびに札の名前が変わる。
  {
    const m = f([
      E(1, day, "done", { by: "Bさん", atTime: "2026-08-29T05:00:00.000Z" }),
      E(1, day, "done", { by: "Aさん", atTime: "2026-08-29T01:00:00.000Z" })
    ], day);
    eq("先に来ても、最後に済ませた人を採る", m.get("1").by, "Bさん");
  }
  {
    const m = f([
      E(1, day, "done", { by: "Aさん", atTime: "2026-08-29T01:00:00.000Z" }),
      E(1, day, "done", { by: "Bさん", atTime: "2026-08-29T05:00:00.000Z" })
    ], day);
    eq("順番を逆にしても同じ結果になる", m.get("1").by, "Bさん");
  }
  {
    const m = f([
      E(1, day, "done", { by: "Bさん" }),
      E(1, day, "done", { by: "Aさん" })
    ], day);
    eq("刻が無い古いデータは、先に来たほうを残す", m.get("1").by, "Bさん");
  }
  {
    const m = f([
      E(1, day, "done", { by: "Bさん" }),
      E(1, day, "done", { by: "Aさん", atTime: "2026-08-29T05:00:00.000Z" })
    ], day);
    eq("刻を持っているほうを採る(空を「最後」と見なさない)", m.get("1").by, "Aさん");
  }
  {
    const m = f([
      E(1, day, "planned", { by: "Aさん", atTime: "2026-08-29T01:00:00.000Z" }),
      E(1, day, "done", { by: "Bさん", atTime: "2026-08-29T05:00:00.000Z" })
    ], day);
    eq("未実施が早くても、実績のあるほうが勝つ", m.get("1").by, "Bさん");
    eq("色は v8.83 の規則のまま(1件でも未なら未実施)", st(m, 1), "planned");
  }
  {
    const m = f([
      E(1, day, "done", { by: "Aさん", atTime: "2026-08-29T01:00:00.000Z", sprayedL: 30 }),
      E(1, day, "done", { by: "Bさん", atTime: "2026-08-29T05:00:00.000Z", sprayedL: 99 })
    ], day);
    eq("数量も最後の作業のものに揃える", m.get("1").sprayedL, 99);
  }
  // 内部の作業用の値を外に出さない
  {
    const m = f([E(1, day, "done")], day);
    eq("_rank は外に出さない", "_rank" in m.get("1"), false);
    eq("_at も外に出さない", "_at" in m.get("1"), false);
  }
  // 呼び側が刻を渡しているか。渡さなければ上の規則は動かない
  eq("サーバーから来た刻を渡す", src.includes("atTime: it.atTime || \"\","), true);
  eq("手元の作業の刻も渡す", src.includes("atTime: w.reportAt || \"\","), true);
}

// ── 台帳への別送をやめた(v9.15・Task2) ────────────────
// pushWorks を受けた側(GAS)が台帳(防除記録)を直接書くようになったので
// (Task1・ledgerFromWorks)、端末から record/report/unreport/pushRecords を
// 別送りする経路(buildLedgerOps・syncPending)は丸ごと不要になった。
{
  eq("buildLedgerOps は app.js から消えている", src.includes("buildLedgerOps"), false);
  eq("buildLedgerOps は EXPORTS からも外してある", EXPORTS.indexOf("buildLedgerOps"), -1);
  eq("syncPending は app.js から消えている", src.includes("syncPending"), false);
  eq("abortSync は app.js から消えている", src.includes("abortSync"), false);
  eq('type: "record" を送る箇所が無い', src.includes('type: "record"'), false);
  eq('type: "report" を送る箇所が無い', src.includes('type: "report"'), false);
  eq('type: "unreport" を送る箇所が無い', src.includes('type: "unreport"'), false);
  eq('type: "pushRecords" を送る箇所が無い', src.includes('type: "pushRecords"'), false);

  // 未送信の印(isPending相当)の意味は変えていない。四つの旗を見たまま
  eq("未送信の判定は synced/reported/reportSynced/unreportPending を見たまま",
    src.includes("const isPending = w => !w.synced || w.reported && !w.reportSynced || !!w.unreportPending;"), true);

  // 台帳を書く唯一の経路(pushWorks=pushProgress)が成功したときだけ、
  // 台帳送信済みの印を立てる。旧 markDone() の代わり
  eq("pushProgress の成功時に台帳の印(synced/reportSynced/unreportPending)を立て直す",
    src.includes("synced: true,\n      reportSynced: w.reported ? true : w.reportSynced,\n      unreportPending: false"), true);

  // 接続テストの「古いGAS」判定は、Task1で足された ledgerFromWorks を見る。
  // pushChems のままだと、台帳を書けない古いGASを繋いでも警告が出ない
  eq("接続テストの古いGAS判定は ledgerFromWorks を見る",
    src.includes('feats.indexOf("ledgerFromWorks") < 0'), true);
  eq("古いGAS判定に pushChems は使っていない",
    src.includes('feats.indexOf("pushChems") < 0'), false);
}

// ── 送信ボタンの文言・配線(v9.15・Task2) ────────────────
// 「台帳へ送信」ではなく「進捗を送信」。押した先も pushProgress 一本にする
{
  eq("作業タブの送信ボタン(地図側)は pushProgress を呼ぶ",
    src.includes("onClick: () => p.pushProgress(),"), true);
  eq("見出しの未送信バッジも pushProgress を呼ぶ",
    src.includes("setTab(\"work\");\n      pushProgress();"), true);
  eq("送信ボタンの文言が「進捗を送信」になっている",
    (src.match(/"☁ 進捗を送信\(未送信 " \+ pending \+ "件\)"/g) || []).length, 2);
  // 中断・途中の圃場から再開する仕組みは record/report を1件ずつ
  // 送っていたときの機能で、pushWorks は1回のまとめ送りなので意味が無い
  eq("「送信を中止」ボタンは無い", src.includes("送信を中止"), false);
  eq("「特定の圃場から送信を再開する」は無い", src.includes("特定の圃場から送信を再開する"), false);
  // 「他の日にも未送信が」の日付切り替え案内は、日をまたいで一括で送る
  // pushProgress では意味が無いので消した。バージョン履歴の過去の記述
  // (v8.7x台。今も昔の出来事として文中に残る)は書き換えない
  eq("pendingOtherDays の配線が残っていない", src.includes("pendingOtherDays"), false);
  // 使わなくなったスタイル定義も片付いているか
  eq("abortBtn のスタイル定義も片付いている", src.includes("abortBtn:"), false);
  eq("planSelect のスタイル定義も片付いている(この再開セレクトでしか使っていなかった)",
    src.includes("planSelect:"), false);
}

// ── 記録者ごとの実績集計(v8.97) ──────────────
// 2チームで回ったあと、どちらがどこをやったのかを見る。
{
  const sum = t.summarizeByRecorder;
  const DAY = "2026-08-29";
  const W = (fieldId, by, fromTeam, reported, sprayedL, reportAreaA, workDate) => ({
    id: fieldId + ":" + (by || "-"), fieldId, workDate: workDate || DAY,
    by, fromTeam: !!fromTeam, reported: !!reported,
    sprayedL, reportAreaA
  });
  const areaOf = () => 10;

  {
    const r = sum([
      W(1, null, false, true, 20, 12),
      W(2, "Bさん", true, true, 30, 15)
    ], DAY, "Aさん", areaOf);
    eq("記録者で分かれる", r.length, 2);
    eq("手元の作業はこの端末の名前", r[0].by, "Aさん");
    eq("他端末の作業はその端末の名前", r[1].by, "Bさん");
  }
  {
    const r = sum([
      W(1, "A", false, true, 20, 12),
      W(2, "A", false, true, 30, 15),
      W(3, "B", true, true, 5, 5)
    ], DAY, "A", areaOf);
    eq("圃場数の多い順", [r[0].by, r[1].by], ["A", "B"]);
    eq("圃場数を数える", r[0].fieldCount, 2);
    eq("面積を足す", r[0].areaA, 27);
    eq("散布量を足す", r[0].sprayedL, 50);
  }
  {
    const r = sum([W(1, "A", false, false, 0, 12)], DAY, "A", areaOf);
    eq("未実施は数えない", r.length, 0);
  }
  {
    const r = sum([W(1, "A", false, true, 20, 12, "2026-08-28")], DAY, "A", areaOf);
    eq("別の日は数えない", r.length, 0);
  }
  {
    const r = sum([W(1, "A", false, true, 20, "")], DAY, "A", areaOf);
    eq("実績面積が無ければ圃場の登録面積を使う", r[0].areaA, 10);
  }
  {
    const r = sum([W(1, "", true, true, 20, 12)], DAY, "A", areaOf);
    eq("名前の無い作業も落とさない", [r.length, r[0].by], [1, "(名前なし)"]);
  }
  {
    const r = sum([
      W(1, "い", false, true, 1, 1), W(2, "あ", true, true, 1, 1)
    ], DAY, "い", areaOf);
    eq("同数なら名前順(見るたびに入れ替わらない)", [r[0].by, r[1].by], ["あ", "い"]);
  }
  {
    eq("作業が無ければ空", sum([], DAY, "A", areaOf).length, 0);
    eq("works が undefined でも落ちない", sum(undefined, DAY, "A", areaOf).length, 0);
    eq("areaOf が無くても落ちない",
      sum([W(1, "A", false, true, 5, "")], DAY, "A", null)[0].areaA, 0);
  }
  // 呼び側の配線。ここが違うと、関数が正しくても画面には出ない
  eq("作業タブでその日を集計する",
    src.includes("summarizeByRecorder(p.works, p.workDate, p.recorder,"), true);
  eq("面積は圃場マスタから引く",
    src.includes("w => p.resolveWork(w).areaA)"), true);
  eq("集計が空の日は表を出さない",
    src.includes("recSummary.length > 0 &&"), true);
  eq("集計の CSV 書き出しがある", src.includes("exportSummaryCSV"), true);
  eq("CSV は数式インジェクション対策をかける",
    src.includes('if (/^[=+' + String.fromCharCode(92) + '-@]/.test(t)) t = "' + String.fromCharCode(39) + '" + t;'), true);
  eq("Excel 向けに BOM を付ける", src.includes('"' + String.fromCharCode(92) + 'uFEFF" + lines.join'), true);
}

// ── 記録者名が端末ごとに違っていた(v8.99) ────
// 送るときにこの端末の名前で上書きしていたため、by が
// 「作業した人」ではなく「最後に送った端末」になっていた。
{
  const out = t.outgoingBy;
  eq("名前が無ければこの端末の記録者名", out({}, "Aさん"), "Aさん");
  eq("既に付いている名前は上書きしない", out({ by: "Bさん" }, "Aさん"), "Bさん");
  eq("他端末の作業を触っても名前は変わらない",
    out({ fromTeam: true, by: "Bさん" }, "Aさん"), "Bさん");
  eq("記録者名が未設定でも落ちない", out({}, undefined), "");
  eq("作業が無くても落ちない", out(null, "Aさん"), "Aさん");

  // 実際に起きていたずれの再現。
  // A が済ませ→B が受け取る→B が数量を直す→B が送る→A が受け取る
  {
    // A の手元(実施済みを押したときに by が付く)
    const onA = { id: 1, reported: true, by: "Aさん" };
    const sentByA = { by: out(onA, "Aさん") };
    eq("A が送る名前", sentByA.by, "Aさん");
    // B が受け取る
    const onB = { id: 1, reported: true, fromTeam: true, by: sentByA.by };
    eq("B の画面でも A", t.workBy(onB, "Bさん"), "Aさん");
    // B が数量を直して送り直す
    const sentByB = { by: out(onB, "Bさん") };
    eq("B が送っても A のまま", sentByB.by, "Aさん");
    // A が受け取り直す
    const backOnA = { id: 1, reported: true, fromTeam: true, by: sentByB.by };
    eq("A の画面も A のまま", t.workBy(backOnA, "Aさん"), "Aさん");
  }
  // 呼び側の配線
  eq("送信は outgoingBy を通す", src.includes("by: outgoingBy(w, recorder),"), true);
  eq("送信で recorder を直に入れていない",
    src.includes("      by: recorder," + String.fromCharCode(10) + "      deviceId,"), false);
  eq("実施済みを押したときに名前を付ける",
    src.includes("reportAt: nowIso()," + String.fromCharCode(10) + "        // 実施済みを押した人"), true);
  eq("取り消しで名前も消す", src.includes('reportAt: "",') && src.includes('by: "",'), true);
  eq("実績を直しても名前は変えない",
    src.includes("by: w.by || recorder" + String.fromCharCode(10) + "    } : w);"), true);
}

// ── 面積ごとに札を出す倍率を分ける(v9.00) ────
// 一律の 15 だと、小さい圃場の札が圃場より大きくなって隣と重なる。
{
  const sz = t.labelSizeOf, vis = t.fieldLabelVisible, Z = t.PROGRESS_LABEL_MIN_ZOOM;
  eq("基準の倍率は 15", Z, 15);

  eq("30a 以上は大", [sz(30).size, sz(30).step], ["lg", 0]);
  eq("100a も大", [sz(100).size, sz(100).step], ["lg", 0]);
  eq("10a は中(基準から1段)", [sz(10).size, sz(10).step], ["md", 1]);
  eq("29.9a は中", sz(29.9).size, "md");
  eq("9.9a は小(基準から2段)", [sz(9.9).size, sz(9.9).step], ["sm", 2]);
  eq("5a は小", sz(5).size, "sm");
  // 面積が無いものを小扱いにすると、寄っても名前が出ない圃場に見える
  eq("面積未登録は大扱い", sz("").size, "lg");
  eq("0 も大扱い", sz(0).size, "lg");
  eq("壊れた値も大扱い", sz("あ").size, "lg");
  eq("文字列の数字でも見る", sz("12").size, "md");

  // 出すかどうか
  eq("大きい圃場は 15 で出る", vis(true, 15, 30), true);
  // 圃場登録タブの地図は基準が 16。基準を渡せること
  eq("基準を 16 にすれば大は 16 から", [vis(true, 15, 30, 16), vis(true, 16, 30, 16)], [false, true]);
  eq("基準 16 で小さい圃場は 18", [vis(true, 17, 5, 16), vis(true, 18, 5, 16)], [false, true]);
  eq("中くらいは 15 では出ない", vis(true, 15, 10), false);
  eq("中くらいは 16 で出る", vis(true, 16, 10), true);
  eq("小さい圃場は 16 では出ない", vis(true, 16, 5), false);
  eq("小さい圃場は 17 で出る", vis(true, 17, 5), true);
  eq("引いていれば大きい圃場でも出ない", vis(true, 14, 100), false);
  // 手動の「札なし」が優先する
  eq("札なしなら寄っても出さない", vis(false, 18, 100), false);

  // 従来の振る舞いを変えていないこと
  eq("全体の入切は今までどおり", [t.labelsVisible(true, 15), t.labelsVisible(true, 14), t.labelsVisible(false, 18)], [true, false, false]);

  // 差分描画の署名に入っているか。入っていないと、倍率を変えても
  // 一部の札だけ古いまま残る
  {
    const f = { id: 1, name: "あ", areaA: 5, polygon: [], updatedAt: "" };
    const st = { status: "done", by: "", at: "", sprayedL: 0, areaA: "", prevDate: "" };
    const big = { id: 1, name: "あ", areaA: 50, polygon: [], updatedAt: "" };
    eq("大きさが違えば署名も違う",
      t.fieldDrawSig(f, st, true, "a") !== t.fieldDrawSig(big, st, true, "a"), true);
  }
  // 描画側の配線
  // 進捗地図(2) ＋ 圃場登録タブの地図(2) で 4か所
  // 進捗2 + 圃場登録2 の候補集めに各1、Google の2つは描画側でも文字の
  // 大きさを決めるのに使うのでもう1つずつ。計6
  eq("4つの地図すべてで使う",
    (src.match(/const lsz = labelSizeOf\(f\.areaA\);/g) || []).length, 6);
  eq("進捗地図は基準 15",
    (src.match(/showLabel && zoom >= PROGRESS_LABEL_MIN_ZOOM \+ lsz\.step/g) || []).length, 2);
  // 候補集めで 2、Google は描画側でも同じ判定を使うので 3
  eq("圃場登録タブは基準 16",
    (src.match(/showLabel && zoom >= FIELD_LABEL_MIN_ZOOM \+ lsz\.step/g) || []).length, 3);
  // v9.02: 間引きは倍率ごとに結果が変わるので、帯では足りない。
  // 帯に戻すと、寄っても落とされたままの札が出てこない
  eq("圃場登録タブは倍率そのもので描き直す",
    (src.match(/Math\.floor\(zoom\), hidden, p\.areaUnitKey/g) || []).length, 2);
  eq("帯(labelBandOf)は残っていない", src.includes("labelBandOf"), false);
  eq("札の大きさを CSS に渡す", src.includes('className: "field-label fl-" + sizeClass'), true);
  // ── 札の作り方(v9.01) ──
  // permanent ツールチップは1枚ごとに実寸を測るため、170枚で 886ms。
  // divIcon なら 17ms(ブラウザで実測)。戻すとスマホが数秒止まる。
  eq("札は divIcon で作る", src.includes("const makeFieldLabel = (L, latlng, html, sizeClass)"), true);
  eq("大きさを測らせない(iconSize は null)", src.includes("iconSize: null"), true);
  eq("札はクリックを食わない", src.includes("interactive: false,") && src.includes("keyboard: false"), true);
  eq("圃場の札に permanent ツールチップを使わない",
    src.includes('permanent: true,') && src.includes('direction: "center"'), false);
  eq("両方の Leaflet 地図で使う(2か所)",
    (src.match(/makeFieldLabel\(L, f\.center \|\| polygonCenter\(f\.polygon\)/g) || []).length, 2);
  eq("札を消すのを忘れていない",
    src.includes("if (cur.label) grp.removeLayer(cur.label);"), true);
  // ここが v9.00 の実装で抜けていた。署名が全体の on/off だけだったため、
  // 倍率を 16 → 17 に上げても小さい圃場が一度も描き直されなかった。
  // v9.02 では間引きの結果まで署名に入れる(入れないと、隣が実施済みになって
  // 札が広がったときに、押し出されたすべき札が残り続ける)
  eq("署名に間引きの結果まで入れる",
    (src.match(/fieldDrawSig\(w\.f, w\.st, (!!w\.label|w\.showLabel), p\.areaUnitKey\)/g) || []).length, 2);
  eq("倍率を変えたら描き直す",
    (src.match(/labelsVisible\(p\.showLabels, zoom\), zoom, p\.onlyTarget/g) || []).length, 2);
}

// ── 台帳を作業シートから作る下ごしらえ(v9.04・提案D) ──
// 「防除記録」の列で唯一作業シートに無かったのが実績メモ。
// これを送らないと、台帳の備考を作業シートから作れない。
{
  eq("実績メモを送る", src.includes('reportMemo: w.reportMemo || "",'), true);
  eq("受け取った実績メモを入れる", src.includes('reportMemo: it.reportMemo || "",'), true);
  // 古いGASはこの列を返さない。空で上書きしないこと(v8.78 で一度壊している)
  eq("無ければ手元を残す",
    src.includes('reportMemo: inc.reportMemo || old.reportMemo || ""'), true);
  eq("照合を手で呼べる", src.includes('type: "ledgerCheck",'), true);
  // 件数だけでは直しようがない。どの列が何件違うかを出す(v9.06)
  eq("結果を表で出す", src.includes("ledgerReportBlock(p.ledgerReport)"), true);
  eq("結果を残す", src.includes("save(LEDGER_CHECK_KEY, j);"), true);
  eq("列ごとの件数を見る", src.includes('tally("食い違った列", j.byCol)'), true);
  // ── 台帳の作り直し(v9.07) ──
  // 元帳を書き換えるので、先に下見を出してから実行する
  eq("下見を先に呼べる", src.includes("p.ledgerRebuild(true)"), true);
  eq("実行も呼べる", src.includes("p.ledgerRebuild(false)"), true);
  // 下見を取っていなければ実行させない。
  // ただし .ok だけを見るのでは足りない(v9.09)。
  // 実行の結果も .ok なので、古い件数のままもう一度押せてしまう。
  // 「下見そのもの」かつ「取ってから新しい」ことを見る
  eq("下見そのものでなければ実行しない",
    src.includes("d.dryRun === true && d.at &&"), true);
  eq("古い下見は使わない",
    src.includes("Date.now() - Date.parse(d.at) < LEDGER_PLAN_MAX_AGE_MS"), true);
  eq("実行したら下見を捨てる",
    src.includes("localStorage.removeItem(LEDGER_PLAN_KEY);"), true);
  // 実行前に件数を見せて確認を取る
  eq("実行前に確認を取る", src.includes("window.confirm("), true);
  eq("行を消さないと書いてある",
    src.includes("行は消しません。受信日時も書き換えません。"), true);
  eq("下見の結果を出す", src.includes("ledgerPlanBlock(p.ledgerPlan)"), true);
  // 「足す 258 件」だけでは、その中身が判断できない。
  // 実施済なのか予定のままなのかを確認の画面にも出す(v9.09)
  eq("足す行の内訳を確認に出す", src.includes("d.addedBy[k]"), true);
  eq("足す行の内訳を表にも出す", src.includes('"足す行の内訳"'), true);
  // ── 進捗の照合の数取り(v9.09) ──
  // 版が上がったら数え直す。直した版でも古い差分の数が
  // 出続けると、「差分00が続いたら外す」を二度と観測できない
  eq("版を覚えておく", src.includes("ver: APP_VERSION,"), true);
  eq("版が違えば数え直す", src.includes("saved && saved.ver === APP_VERSION"), true);
  eq("照合は書き込まない(ボタンの案内に明記)",
    src.includes("読むだけで、シートは書き換えません"), true);
}

// ── 重なる札を間引く(v9.02) ────────────────────
// 倍率のしきい値(v9.00)だけでは重なりを止められない。倍率15では30aの圃場でも
// 27px しかないのに札は 60〜90px あるので、170圃場を引いて見ると札が
// 連なって地図が見えなくなる。
{
  const box = t.labelBoxOf, thin = t.thinLabels, em = t.textEmWidth;

  // 1文字の幅の見積り。和字は全角、ラテン・数字は半角
  eq("和字は1em", em("あいう"), 3);
  eq("数字は半角", em("123"), 3 * 0.58);
  eq("混ざっても足す", Math.round(em("田60") * 100) / 100, Math.round((1 + 0.58 * 2) * 100) / 100);
  eq("空でも落ちない", [em(""), em(null), em(undefined)], [0, 0, 0]);
  // 記号(✅など)は全角扱い。半角にすると札を狭く見積もって重なりが残る
  eq("記号は全角扱い", em("✅"), 1);

  // 札の外形。CSS(index.html の .fl-inner)と揃っていること
  {
    const b = box([{ text: "あいうえお" }, { text: "10.0 a", sub: true }], "lg");
    // 幅 = 一番長い行(5em × 13px) + 左右の余白 7px × 2
    eq("大の幅", b.w, 5 * 13 + 14);
    // 高さ = 13×1.25 + 12×1.2 + 上下の余白 3px × 2
    eq("大の高さ", b.h, Math.round(13 * 1.25) + Math.round(12 * 1.2) + 6);
  }
  eq("小さい札のほうが小さい",
    box([{ text: "あいう" }], "sm").w < box([{ text: "あいう" }], "lg").w, true);
  eq("行が増えれば高くなる",
    box([{ text: "あ" }, { text: "い", sub: true }], "md").h >
      box([{ text: "あ" }], "md").h, true);
  eq("一番長い行で幅が決まる",
    box([{ text: "あ" }, { text: "あいうえお", sub: true }], "md").w >
      box([{ text: "あ" }, { text: "い", sub: true }], "md").w, true);
  eq("知らない大きさは中扱い", box([{ text: "あ" }], "xx").w, box([{ text: "あ" }], "md").w);
  eq("行が無くても落ちない", [box([], "md").w, box(null, "md").w], [12, 12]);

  // 圃場1枚ぶん。記録者名の行があると高くなる
  eq("記録者名の行があると高い",
    t.fieldLabelBox("あ", "10 a", "藤本", "md").h > t.fieldLabelBox("あ", "10 a", "", "md").h, true);

  // 間引き本体
  const it = (id, x, y, pri) => ({ id: id, x: x, y: y, w: 100, h: 20, pri: pri });
  eq("離れていれば全部残る",
    [...thin([it("a", 0, 0, 1), it("b", 500, 0, 1)])].sort(), ["a", "b"]);
  eq("重なれば大きい圃場が残る",
    [...thin([it("small", 0, 0, 5), it("big", 10, 0, 50)])], ["big"]);
  eq("順番を変えても結果は同じ",
    [...thin([it("big", 10, 0, 50), it("small", 0, 0, 5)])], ["big"]);
  // 面積が同じなら id 順。並び順で変わると45秒ごとの取り直しでちらつく
  eq("面積が同じなら id 順で決める",
    [...thin([it("b", 10, 0, 9), it("a", 0, 0, 9)])], ["a"]);
  // 縦にずれていれば重ならない。札は横長なので、縦の判定が要る
  eq("縦にずれていれば残る",
    [...thin([it("a", 0, 0, 1), it("b", 10, 40, 1)])].sort(), ["a", "b"]);
  eq("接しているだけなら残す(境目がぴったり)",
    [...thin([it("a", 0, 0, 1), it("b", 100, 0, 1)])].sort(), ["a", "b"]);
  eq("3枚重なっても残るのは1枚",
    [...thin([it("a", 0, 0, 3), it("b", 10, 0, 2), it("c", 20, 0, 1)])], ["a"]);
  // 落とした札は場所を取らない。取ると、落とした先で余計に落ちる
  eq("落とした札は場所を取らない",
    [...thin([it("a", 0, 0, 3), it("b", 10, 0, 2), it("c", 130, 0, 1)])].sort(), ["a", "c"]);
  eq("空でも落ちない", [[...thin([])], [...thin(null)]], [[], []]);
  eq("元の配列を壊さない", (() => {
    const src2 = [it("b", 10, 0, 1), it("a", 0, 0, 9)];
    thin(src2);
    return src2.map(x => x.id);
  })(), ["b", "a"]);

  // 優先度。面積が未登録のものは labelSizeOf と揃えて「大」扱い
  eq("面積がそのまま優先度", t.labelPriOf(30), 30);
  eq("未登録は大扱い", t.labelPriOf(""), t.LABEL_SIZE_BREAKS[0].min);
  eq("0 も大扱い", t.labelPriOf(0), t.LABEL_SIZE_BREAKS[0].min);
  eq("文字列の数字も読む", t.labelPriOf("12.5"), 12.5);

  // 配線。4つの地図すべてで間引くこと
  eq("4つの地図すべてで間引く",
    (src.match(/thinLabels\(cand\)/g) || []).length, 4);
  // 見ている場所によらない座標で判定する。画面座標だと地図を動かすたびに
  // 出たり消えたりして読めない
  eq("Leaflet は project の絶対座標で判定する",
    (src.match(/\.project\(\[ctr\[0\], ctr\[1\]\], Math\.floor\(zoom\)\)/g) || []).length, 2);
  eq("Google は fromLatLngToPoint × 2^倍率",
    (src.match(/proj\.fromLatLngToPoint\(new g\.LatLng\(ctr\[0\], ctr\[1\]\)\)/g) || []).length, 2);
  // getProjection は地図の準備ができるまで null。そのときは間引かない
  eq("Google は準備前でも札を出す",
    (src.match(/const keep = proj \? thinLabels\(cand\) : null;/g) || []).length, 2);
  // 大きさは測らない。測ると v9.01 で消した同期レイアウトが戻る
  // コメントの中には「なぜ読まないか」の説明があるので、コードの行だけ見る
  eq("大きさを測らない(offsetWidth を読まない)",
    src.split(String.fromCharCode(10))
      .filter(l => !l.trim().startsWith("//")).join(String.fromCharCode(10))
      .includes("offsetWidth"), false);
}

// ── 札に出す記録者名(v8.97) ──────────────────
{
  const L = t.labelByText;
  eq("実施済みなら出す", L("done", "藤本"), "藤本");
  eq("前日までに済でも出す", L("donePrev", "藤本"), "藤本");
  eq("未実施には出さない", L("planned", "藤本"), "");
  eq("対象外にも出さない", L("none", "藤本"), "");
  eq("名前が空なら行を作らない", L("done", ""), "");
  eq("空白だけの名前も行を作らない", L("done", "   "), "");
  eq("名前が無い(undefined)でも落ちない", L("done", undefined), "");
  eq("前後の空白は落とす", L("done", " 藤本 "), "藤本");
  // 描画側。Leaflet と Google の両方で使うこと
  eq("Leaflet の札で使う", src.includes('labelByText(key, st && st.by)'), true);
  eq("Leaflet はエスケープしてから入れる(XSS)",
    src.includes("escapeHtml(lb.by)") && src.includes("fl-by"), true);
  // Leafletの候補集め / Googleの候補集め / Googleの描画で 3か所
  eq("Google 側でも使う",
    (src.match(/labelByText\(key, st && st\.by\)/g) || []).length, 3);
  eq("差分描画の署名に記録者名が入っている(入っていないと札が古いまま)",
    src.includes('st ? st.by || "" : "",'), true);
}

// ── 実施した人の名前(v8.97) ────────────────────
// 他の端末がやった作業を受け取っても、地図ではこの端末の記録者名で
// 上書きされていた。吹き出しの名前が全部自分になる。
{
  const by = t.workBy;
  eq("他端末の作業はその端末の記録者名を使う",
    by({ fromTeam: true, by: "Bさん" }, "Aさん"), "Bさん");
  eq("手元で作った作業はこの端末の記録者名",
    by({ fromTeam: false }, "Aさん"), "Aさん");
  eq("他端末なのに名前が空なら空のまま(偵称しない)",
    by({ fromTeam: true, by: "" }, "Aさん"), "");
  eq("by を持っている手元の作業はそちらを優先",
    by({ by: "Cさん" }, "Aさん"), "Cさん");
  eq("作業が無ければ空", by(null, "Aさん"), "");
  eq("記録者名が未設定でも落ちない", by({}, undefined), "");
  // 呼び側。ここを p.recorder に戻すと上の修正が無効になる
  eq("地図の状態は workBy を通す",
    src.includes("by: workBy(w, recorder),"), true);
  eq("p.recorder を直に入れていない",
    src.includes('by: p.recorder || "",'), false);
}

// ── 吹き出しが対象にする作業(v8.96) ──────────────────
// v8.95 で取得範囲を3日に広げたとき、吹き出しもその範囲で作業を探して
// いた。引き継いだ圃場では「✓ 散布済にする」が出ず、出た圃場でも
// 2日前の実績が変わるだけで今日の色が動かなかった。現場で使えなくなった。
{
  const pick = t.pickWorkOfDay;
  const W = (fieldId, workDate, reported, id) => ({ id: id || (workDate + ":" + fieldId), fieldId, workDate, reported: !!reported });
  const DAY = "2026-08-29", PREV = "2026-08-27";

  // ── 今回の症状そのもの ──
  {
    // 引き継いで今日だけ登録した圃場。2日前には作業が無い
    const works = [W(1, DAY, false)];
    const sw = pick(works, 1, DAY);
    eq("引き継いだ圃場でも作業が見つかる(ボタンが出る)", !!sw, true);
    eq("見つかるのは今日の作業", sw && sw.workDate, DAY);
  }
  {
    // 2日前に済ませ、今日も入っている圃場
    const works = [W(1, PREV, true), W(1, DAY, false)];
    const sw = pick(works, 1, DAY);
    eq("2日前の作業を掴まない", sw && sw.workDate, DAY);
    eq("掴むのは今日の未実施", sw && sw.reported, false);
  }
  {
    // 2日前だけにある圃場は、今日の吹き出しでは対象にしない
    const works = [W(1, PREV, false)];
    eq("2日前だけの圃場は対象にしない(＋本日の作業に追加が出る)",
      pick(works, 1, DAY), undefined);
  }

  // ── 従来の規則は変えていない ──
  {
    const works = [W(1, DAY, true, "a"), W(1, DAY, false, "b")];
    eq("同じ日に2件あれば未実施を先に取る", (pick(works, 1, DAY) || {}).id, "b");
  }
  {
    const works = [W(1, DAY, true, "a"), W(1, DAY, true, "b")];
    eq("全部済んでいれば最後の1件(取り消しの対象)", (pick(works, 1, DAY) || {}).id, "b");
  }
  {
    eq("別の圃場は拾わない", pick([W(2, DAY, false)], 1, DAY), undefined);
    eq("圃場IDは文字列と数値が混ざっても合う", !!pick([W("1", DAY, false)], 1, DAY), true);
    eq("作業が無ければ undefined", pick([], 1, DAY), undefined);
    eq("works が無くても落ちない", pick(null, 1, DAY), undefined);
    eq("作業日が無いものは拾わない", pick([{ fieldId: 1, reported: false }], 1, DAY), undefined);
  }
}

// ── 引き継ぐ圃場を選ぶ(v8.95) ────────────────────────
{
  const c = t.carryOverFieldIds;
  const W = (fieldId, workDate, reported) => ({ id: workDate + ":" + fieldId, fieldId, workDate, reported: !!reported });
  const day = "2026-08-29";

  eq("前日の未実施は引き継ぐ", c([W(1, "2026-08-28", false)], day, 3), [1]);
  eq("前日に済んでいれば引き継がない", c([W(1, "2026-08-28", true)], day, 3), []);
  eq("前々日の未実施も引き継ぐ", c([W(1, "2026-08-27", false)], day, 3), [1]);
  eq("3日より前は見ない", c([W(1, "2026-08-26", false)], day, 3), []);
  eq("今日ぶんは対象外(もう入っている)", c([W(1, day, false)], day, 3), []);
  eq("既に今日のリストにあれば引き継がない",
    c([W(1, "2026-08-28", false), W(1, day, false)], day, 3), []);
  // 前日やり残して、その後べつの日に済ませた圃場を蒸し返さない
  eq("期間内に一度でも済んでいれば引き継がない",
    c([W(1, "2026-08-27", false), W(1, "2026-08-28", true)], day, 3), []);
  eq("済んだ日が先でも同じ",
    c([W(1, "2026-08-27", true), W(1, "2026-08-28", false)], day, 3), []);
  // 同じ圃場で未実施が2件あっても1回だけ返す
  eq("同じ圃場は1回だけ",
    c([W(1, "2026-08-27", false), W(1, "2026-08-28", false)], day, 3), [1]);
  // 複数の圃場
  eq("残っているものだけ返す",
    c([W(1, "2026-08-28", false), W(2, "2026-08-28", true), W(3, "2026-08-28", false)], day, 3),
    [1, 3]);
  // 未来の日付は見ない
  eq("先の日付は引き継がない", c([W(1, "2026-08-30", false)], day, 3), []);
  // 壊れたデータで落ちない
  eq("作業日が無いものは無視", c([{ fieldId: 1, reported: false }], day, 3), []);
  eq("空でも落ちない", c([], day, 3), []);
  eq("works が無くても落ちない", c(null, day, 3), []);
  // 日数を変えられる
  eq("2日ぶんなら前々日は見ない", c([W(1, "2026-08-27", false)], day, 2), []);
  // 既定は PROGRESS_CARRY_DAYS(=2)。選んでいる日は 2026-08-29 なので、
  // 見るのは 08-28 まで。前々日(08-27)は入らない
  eq("既定は今日と前日だけ", c([W(1, "2026-08-27", false)], day), []);
  eq("前日のやり残しは既定で拾う", c([W(1, "2026-08-28", false)], day), [1]);
}

// ── 引き継ぎが画面まで届いているか(ソースの形) ────────
{
  eq("引き継ぎの入口がある", src.includes("carryOverWorks"), true);
  eq("押す前に確認する", /carryOverWorks = \(\) => \{[\s\S]{0,900}confirm\(/.test(src), true);
  eq("確認に件数と圃場名を出す",
    /confirm\("直近"[\s\S]{0,300}ids\.length[\s\S]{0,200}head \+ rest/.test(src), true);
  eq("圃場だけ入れる(薬剤は持ってこない)",
    /carryOverWorks = \(\) => \{[\s\S]{0,1400}addWorks\(ids\);/.test(src), true);
  // 引き継ぎの関数の中だけを見る(すぐ下の removeWork は墓標を積むので)
  eq("前の日の記録は消さない(墓標を積んでいない)", (() => {
    const a = src.indexOf("const carryOverWorks = () => {");
    const b = src.indexOf("addWorks(ids);", a);
    return a > 0 && b > a && src.slice(a, b).indexOf("addTomb") < 0;
  })(), true);
  eq("件数が0のときはボタンを出さない", src.includes("p.carryOverCount > 0 &&"), true);
  eq("差分描画の署名に前日の日付も入っている(青が更新される)",
    /fieldDrawSig = [\s\S]{0,1200}st\.prevDate/.test(src), true);
  eq("前日までに済はその日の圃場数に数えない",
    /if \(v\.status === "donePrev"\) return;[\s\S]{0,60}c\.total\+\+;/.test(src), true);
  eq("吹き出しに、いつ済んだかを出す",
    /sel\.st\.status === "donePrev"[\s\S]{0,600}sel\.st\.prevDate/.test(src), true);
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
    // 第3引数は「この圃場の札を今の倍率で実際に出すか」。全体の on/off を渡すと、
    // 倍率を上げても署名が変わらず小さい圃場の札が永久に出ない(v9.00)。
    // 間引き(v9.02)の結果もここに入る
    eq(name + " は署名で比べる",
      /fieldDrawSig\(w\.f, w\.st, (!!w\.label|w\.showLabel), p\.areaUnitKey\)/.test(body), true);
    eq(name + " は重なる札を間引く",
      body.includes("thinLabels(cand)"), true);
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

// ── サーバーにだけ残っている作業(v9.10) ──────────────
// 「🧹 サーバーから外す」に渡る一覧。押すと墓標が積まれ、他の端末からも消える。
// 取り消せないので、拾いすぎは事故そのもの。
{
  const O = t.serverOrphans;
  const item = o => Object.assign({ id: 1, fieldId: 7, workDate: "2026-08-31" }, o);
  const work = o => Object.assign({ id: 1, fieldId: 7, workDate: "2026-08-31" }, o);
  const ids = r => r.map(x => String(x.id));

  eq("手元にある作業は残骸ではない",
    O([item({ id: 1 })], [work({ id: 1 })], "2026-08-30", "2026-08-31"), []);
  eq("手元に無い作業は残骸",
    ids(O([item({ id: 9 })], [work({ id: 1 })], "2026-08-30", "2026-08-31")), ["9"]);
  eq("作業IDが無いものは拾わない(古い Code.gs)",
    O([item({ id: "" })], [], "2026-08-30", "2026-08-31"), []);
  eq("IDの型が違っても同じものと見る",
    O([item({ id: 123 })], [work({ id: "123" })], "2026-08-30", "2026-08-31"), []);

  // ここから本題。
  // 保存してある写し(tankmix:progresssnap)は前の期間のものが残る。
  // 作業日を変えた直後は取り直しが終わっておらず、圏外なら永久に終わらない。
  // 手元だけを新しい期間で絞ると、前の期間の作業が丸ごと「残骸」に見える。
  // 実際には手元にちゃんとある作業なので、押せば全部消える。
  eq("写しが範囲の外の日を含んでいても拾わない",
    O([item({ id: 5, workDate: "2026-08-20" })],
      [work({ id: 5, workDate: "2026-08-20" })],
      "2026-08-30", "2026-08-31"), []);
  // 範囲の外なら、手元に無くても拾わない。
  // 「直近3日の作業N件」と言いながら別の期間を消すことになる
  eq("範囲の外は手元に無くても拾わない",
    O([item({ id: 6, workDate: "2026-08-20" })], [], "2026-08-30", "2026-08-31"), []);
  // 日付が入っていない行は判断できない。拾わない側に倒す(消すのは戻せない)
  eq("日付の無い行は拾わない",
    O([item({ id: 7, workDate: "" })], [], "2026-08-30", "2026-08-31"), []);
  // 範囲の中の本物の残骸は、これまでどおり拾えること
  eq("範囲の中の残骸は拾う",
    ids(O([item({ id: 8, workDate: "2026-08-30" }), item({ id: 9, workDate: "2026-08-20" })],
      [], "2026-08-30", "2026-08-31")), ["8"]);

  eq("useMemo は serverOrphans を呼ぶ(直書きに戻していない)",
    src.includes("serverOrphans(snap.items, p.works, fetchFrom, fetchTo)"), true);
}

// ── 札を出す倍率は1か所で決める(v9.10) ─────────────────
// 圃場登録タブの地図は Leaflet と Google の2実装。v9.10 まで、基準倍率 16 を
// それぞれの component の中に別々に書いていた。片方だけ動かしても誰も気づかない。
// 進捗地図の側には「ここに絶対の倍率を書かない。書くと片方の地図の振る舞いが
// 変わる」と注意書きまであるのに、圃場登録タブがそれを破っていた。
// 実際 v9.10 で、Leaflet に入れてあった手当てが Google 側に無いのが見つかっている。
{
  eq("基準は 16", t.FIELD_LABEL_MIN_ZOOM, 16);
  eq("進捗地図とは別の値", t.FIELD_LABEL_MIN_ZOOM === t.PROGRESS_LABEL_MIN_ZOOM, false);
  // component の中に自前の定数を持たせない。持たせると2つに割れる
  eq("component ごとの定数は残っていない",
    src.includes("const LABEL_MIN_ZOOM = 16;"), false);
  eq("2つの地図が同じ定数を見ている",
    (src.match(/const showLabel = zoom >= FIELD_LABEL_MIN_ZOOM;/g) || []).length, 2);

  // 定数を通した実際の判定。面積で出る倍率が変わる(v9.00)
  const vis = t.fieldLabelVisible, Z = t.FIELD_LABEL_MIN_ZOOM;
  eq("大(30a以上)は 16 で出る", vis(true, Z, 50, Z), true);
  eq("中(10a以上)は 16 では出ない", vis(true, Z, 20, Z), false);
  eq("中(10a以上)は 17 で出る", vis(true, Z + 1, 20, Z), true);
  eq("小は 18 で出る", vis(true, Z + 2, 5, Z), true);
  eq("札なしにすれば倍率によらず出ない", vis(false, Z + 5, 50, Z), false);
}

// ── 進捗地図: 高さが入ってから寄せる(v9.10) ────────────
// 高さ0のまま fitBounds を呼ぶと倍率がでたらめになる。しかも寄せた印
// (fittedRef)を立ててしまうと、ResizeObserver 側の「大きさが決まったら
// もう一度寄せる」も走らなくなり、直る機会が無くなる。
// Leaflet 側は v8.9x で入れてあったが、Google 側に入っていなかった。
// Google 版は API キーが無く未検証なので、並びが揃っているかだけを見る。
{
  eq("Leaflet版は高さを見てから寄せる",
    src.includes("targetBounds.length && mapRef.current.getSize().y > 80"), true);
  eq("Google版も高さを見てから寄せる",
    src.includes("targetBounds.length && boxH > 80"), true);
}

// ── 版数の整合(sw.js と揃っているか) ───────────────────
const sw = nl(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"));
const swVer = (sw.match(/CACHE_VERSION = "tankmix-(v[\d.]+)"/) || [])[1];
eq("版数 app.js と sw.js が一致", swVer, t.APP_VERSION);
eq("版数は v9.15(台帳への別送をやめた版)", t.APP_VERSION, "v9.15");

// ── 結果 ─────────────────────────────────────────────
console.log("");
if (fails.length === 0) {
  console.log("  ✓ " + pass + " 件すべて成功");
  process.exit(0);
}
console.log("  ✓ 成功 " + pass + " 件 ／ ✗ 失敗 " + fails.length + " 件\n");
fails.forEach((f, i) => console.log("  " + (i + 1) + ". " + f + "\n"));
process.exit(1);
