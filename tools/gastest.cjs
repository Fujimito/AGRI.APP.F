// Code.gs の受信処理を Node 上で動かして確かめる自己テスト。
//
//   node tools/gastest.cjs
//
// スプレッドシートと各サービスの張りぼては tools/gasharness.cjs にある
// (ローカル確認用サーバー tools/fakegas.cjs と共用しているため)。
"use strict";
const { makeContext, post } = require("./gasharness.cjs");

// ─────────── 判定 ───────────
let pass = 0;
const fails = [];
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fails.push(label + "\n    got  " + g + "\n    want " + w);
}
function ok(label, cond) { eq(label, !!cond, true); }

// ─────────── テスト ───────────
const TEAM = "team-a";
const F1 = {
  id: 1001, name: "北の田", crop: "水稲", area: "上地区", areaA: 12.5,
  center: [33.1, 130.4], polygon: [[33.1, 130.4], [33.1, 130.5], [33.2, 130.5]],
  updatedAt: "2026-08-01T00:00:00.000Z", by: "藤本", deviceId: "dev-1",
};
const F2 = {
  id: 1002, name: "南の田", crop: "大豆", area: "下地区", areaA: 8,
  center: [33.0, 130.3], polygon: [[33.0, 130.3], [33.0, 130.4], [33.1, 130.4]],
  updatedAt: "2026-08-01T00:00:00.000Z", by: "藤本", deviceId: "dev-1",
};

// ── 1. 圃場の新規投入 ──
{
  const ctx = makeContext({});
  const r = post(ctx, { type: "pushFields", team: TEAM, items: [F1, F2] });
  eq("pushFields 追加件数", [r.ok, r.added, r.updated, r.skipped], [true, 2, 0, 0]);

  const sh = ctx.SHEET_STATE.getSheetByName("圃場マスタ");
  ok("圃場マスタが作られる", !!sh);
  eq("ヘッダー", sh.getRange(1, 1, 1, 3).getValues()[0], ["圃場ID", "チームコード", "名称"]);
  eq("行数(ヘッダー込み)", sh.getLastRow(), 3);
  eq("1行目の名称", sh.getRange(2, 3).getValue(), "北の田");
}

// ── 2. pull の差分取得 ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM, items: [F1, F2] });
  const all = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("pull 全件", [all.ok, all.fields.length, all.works.length], [true, 2, 0]);
  eq("pull ポリゴンが復元される", all.fields[0].polygon, F1.polygon);
  eq("pull 中心座標", all.fields[0].center, [33.1, 130.4]);
  eq("pull 面積", all.fields[0].areaA, 12.5);

  // serverTime は「今」ではなく PULL_LAG_MS ぶん手前を返す。押し込み中だった行を
  // 取りこぼさないための幅なので、直後に同じ since で引くと同じ行が再び返る。
  const none = post(ctx, { type: "pull", team: TEAM, since: all.serverTime });
  eq("直近の行は配り直される(冪等なので害はない)", none.fields.length, 2);
  const after = post(ctx, { type: "pull", team: TEAM, since: new Date().toISOString() });
  eq("今より後を求めれば0件", after.fields.length, 0);

  const other = post(ctx, { type: "pull", team: "team-b", since: "" });
  eq("別チームには配らない", other.fields.length, 0);
}

// ── 3. 競合:古い編集は勝たない ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM, items: [F1] });
  const newer = Object.assign({}, F1, { name: "北の田(改)", updatedAt: "2026-08-05T00:00:00.000Z" });
  const r1 = post(ctx, { type: "pushFields", team: TEAM, items: [newer] });
  eq("新しい編集は上書きする", [r1.updated, r1.skipped], [1, 0]);

  const older = Object.assign({}, F1, { name: "巻き戻し", updatedAt: "2026-07-01T00:00:00.000Z" });
  const r2 = post(ctx, { type: "pushFields", team: TEAM, items: [older] });
  eq("古い編集は捨てる", [r2.updated, r2.skipped], [0, 1]);

  const after = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("値が巻き戻っていない", after.fields[0].name, "北の田(改)");
}

// ── 4. 上書き前の値が履歴に残る ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM, items: [F1] });
  eq("新規追加では履歴を積まない",
     !!ctx.SHEET_STATE.getSheetByName("_共有データ履歴"), false);
  post(ctx, { type: "pushFields", team: TEAM,
              items: [Object.assign({}, F1, { name: "改", updatedAt: "2026-08-09T00:00:00.000Z" })] });
  const log = ctx.SHEET_STATE.getSheetByName("_共有データ履歴");
  ok("上書き時は履歴シートができる", !!log);
  eq("履歴が1件", log.getLastRow(), 2);
  ok("履歴に上書き前の名称が入る", String(log.getRange(2, 4).getValue()).indexOf("北の田") >= 0);
}

// ── 5. 作業と進捗 ──
{
  const ctx = makeContext({});
  const W = (id, fieldId, status, sprayedL) => ({
    id: id, workDate: "2026-08-20", fieldId: fieldId, fieldName: "圃場" + fieldId,
    status: status, plannedL: 100, sprayedL: sprayedL, reportAreaA: 10,
    chemCount: 2, chemText: "薬剤A(10倍) / 薬剤B(16倍)", by: "藤本", deviceId: "dev-1",
    reportedAt: status === "done" ? "2026-08-20T02:00:00.000Z" : "",
    updatedAt: "2026-08-20T02:00:00.000Z",
  });
  const r = post(ctx, { type: "pushWorks", team: TEAM,
                        items: [W(2001, 1001, "done", 95), W(2002, 1002, "planned", 0)] });
  eq("pushWorks 追加件数", [r.ok, r.added], [true, 2]);

  const p = post(ctx, { type: "progress", team: TEAM, date: "2026-08-20" });
  eq("progress 件数", [p.ok, p.items.length], [true, 2]);
  eq("progress 実績済の内容",
     [p.items[0].fieldId, p.items[0].status, p.items[0].sprayedL, p.items[0].by],
     [1001, "done", 95, "藤本"]);
  eq("progress 未実績の状態", p.items[1].status, "planned");
  ok("progress はポリゴンを返さない", p.items[0].polygon === undefined);

  const other = post(ctx, { type: "progress", team: TEAM, date: "2026-08-21" });
  eq("別の日は0件", other.items.length, 0);

  // 削除は論理削除。進捗からは消えるが pull では削除フラグつきで配られる
  post(ctx, { type: "pushWorks", team: TEAM,
              items: [Object.assign(W(2002, 1002, "planned", 0),
                                    { deleted: true, updatedAt: "2026-08-20T03:00:00.000Z" })] });
  const p2 = post(ctx, { type: "progress", team: TEAM, date: "2026-08-20" });
  eq("削除した作業は進捗に出ない", p2.items.length, 1);
  const pl = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("pull では削除フラグつきで配られる", pl.works.filter(w => w.deleted).length, 1);
}

// ── 6. 数式インジェクション ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM,
              items: [Object.assign({}, F1, { name: '=IMPORTXML("http://x","//y")' })] });
  const sh = ctx.SHEET_STATE.getSheetByName("圃場マスタ");
  eq("= 始まりの圃場名はアポストロフィで固定する",
     String(sh.getRange(2, 3).getValue()).charAt(0), "'");
}

// ── 7. 件数上限 ──
{
  const ctx = makeContext({});
  const max = ctx.read("PUSH_MAX");
  ok("PUSH_MAX が読めている", max > 0);
  const many = [];
  for (let i = 0; i < max + 1; i++) many.push(Object.assign({}, F1, { id: 3000 + i }));
  const r = post(ctx, { type: "pushFields", team: TEAM, items: many });
  eq("上限超過は黙って捨てず断る", [r.ok, r.error, r.max], [false, "too many", max]);
  eq("断ったので1件も書かれていない",
     !!ctx.SHEET_STATE.getSheetByName("圃場マスタ"), false);
}

// ── 8. 合言葉 ──
{
  const ctx = makeContext({ SHARED_SECRET: "correct-horse-battery-staple" });
  eq("合言葉なしは弾く",
     post(ctx, { type: "pushFields", team: TEAM, items: [F1] }).error, "auth");
  eq("合言葉違いは弾く",
     post(ctx, { type: "progress", team: TEAM, date: "2026-08-20", auth: "x" }).error, "auth");
  const r = post(ctx, { type: "pushFields", team: TEAM, items: [F1],
                        auth: "correct-horse-battery-staple" });
  eq("合言葉が合えば通る", r.ok, true);
}

// ── 9. 読み取りはロックを待たない ──
// 進捗マップの「最新を取得」が、他の端末の送信中に busy で落ちないこと。
{
  const ctx = makeContext({});
  post(ctx, { type: "pushWorks", team: TEAM, items: [{
    id: 2001, workDate: "2026-08-20", fieldId: 1001, status: "done",
    sprayedL: 95, updatedAt: "2026-08-20T02:00:00.000Z",
  }] });
  ctx.LOCK_FREE = false;
  eq("書き込みは busy を返す",
     post(ctx, { type: "pushWorks", team: TEAM, items: [] }).error, "busy");
  const p = post(ctx, { type: "progress", team: TEAM, date: "2026-08-20" });
  eq("ロック中でも progress は返る", [p.ok, p.items.length], [true, 1]);
  eq("ロック中でも pull は返る", post(ctx, { type: "pull", team: TEAM, since: "" }).ok, true);
}

// ── 10. team 未指定 ──
{
  const ctx = makeContext({});
  eq("pushFields は team 必須", post(ctx, { type: "pushFields", items: [F1] }).error, "team required");
  eq("progress は team 必須", post(ctx, { type: "progress", date: "2026-08-20" }).error, "team required");
  eq("items が配列でなければ断る",
     post(ctx, { type: "pushFields", team: TEAM, items: "x" }).error, "items required");
}

// ── 11. 既存機能を壊していないこと ──
{
  const ctx = makeContext({});
  const rec = {
    id: 9001, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: [{ name: "薬剤A", useName: "殺菌剤", formName: "フロアブル", ratio: 1000, ml: 100 }],
    totalL: 100, waterMl: 99900, memo: "",
  };
  const r1 = post(ctx, { type: "record", recorder: "藤本", record: rec });
  eq("防除記録は従来どおり追記される", [r1.ok, r1.added], [true, 1]);
  const sh = ctx.SHEET_STATE.getSheetByName("防除記録");
  eq("防除記録のヘッダーは変えていない", sh.getRange(1, 1, 1, 3).getValues()[0],
     ["受信日時", "記録ID", "散布日"]);
  eq("状態列", sh.getRange(2, 13).getValue(), "調合済");
  const r2 = post(ctx, { type: "report", recorder: "藤本",
                         record: Object.assign({}, rec, { sprayedL: 95, reportDate: "2026-08-20" }) });
  eq("散布実績は既存行を更新する", [r2.ok, r2.updated], [true, 1]);
  eq("状態が散布済になる", sh.getRange(2, 13).getValue(), "散布済");
  eq("実散布量", sh.getRange(2, 12).getValue(), 95);

  // 旧方式(cloudSave/cloudLoad)も残っていること
  const s = post(ctx, { type: "cloudSave", team: TEAM, payload: '{"fields":[]}', by: "藤本" });
  eq("cloudSave は残っている", s.ok, true);
  eq("cloudLoad は残っている",
     post(ctx, { type: "cloudLoad", team: TEAM }).payload, '{"fields":[]}');
}

// ── 12. 実績の取り消し ──
{
  const ctx = makeContext({});
  const rec = {
    id: 9001, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: [{ name: "薬剤A", ratio: 1000, ml: 100 }],
    totalL: 100, waterMl: 99900, memo: "",
  };
  post(ctx, { type: "record", recorder: "藤本", record: rec });
  post(ctx, { type: "report", recorder: "藤本",
              record: Object.assign({}, rec, { sprayedL: 95, reportDate: "2026-08-20" }) });
  const sh = ctx.SHEET_STATE.getSheetByName("防除記録");
  eq("取消前 状態", sh.getRange(2, 13).getValue(), "散布済");

  const r = post(ctx, { type: "unreport", recorder: "藤本", record: rec });
  eq("取消 更新件数", [r.ok, r.updated], [true, 1]);
  eq("取消 状態が調合済に戻る", sh.getRange(2, 13).getValue(), "調合済");
  eq("取消 実散布量が空になる", sh.getRange(2, 12).getValue(), "");
  eq("取消 報告日が空になる", sh.getRange(2, 14).getValue(), "");
  eq("取消 行は消さない(調合した事実は残す)", sh.getLastRow(), 2);
  eq("取消 薬剤内容は残る", String(sh.getRange(2, 9).getValue()).indexOf("薬剤A") >= 0, true);

  // 送り直せば散布済に戻る
  post(ctx, { type: "report", recorder: "藤本",
              record: Object.assign({}, rec, { sprayedL: 80, reportDate: "2026-08-21" }) });
  eq("取消後に再報告できる",
     [sh.getRange(2, 13).getValue(), sh.getRange(2, 12).getValue()], ["散布済", 80]);

  // 元の行が無いときは、失敗ではなく「取り消すものが無い」で成功にする。
  // 失敗にするとアプリが永久に再送し続ける
  const r2 = post(ctx, { type: "unreport", recorder: "藤本", record: { id: 9999, chems: [] } });
  eq("取消 元の行が無ければ成功扱い", [r2.ok, r2.missing], [true, true]);
}

// ── 13. 薬剤マスタ(レコード単位の共有) ──
{
  const ctx = makeContext({});
  const C1 = { id: "パレード20フロアブル", name: "パレード20フロアブル",
               use: "fungicide", form: "sc", maxUse: 3,
               updatedAt: "2026-08-01T00:00:00.000Z", by: "藤本", deviceId: "dev-1" };
  const r = post(ctx, { type: "pushChems", team: TEAM, items: [C1] });
  eq("pushChems 追加件数", [r.ok, r.added, r.updated], [true, 1, 0]);

  const sh = ctx.SHEET_STATE.getSheetByName("薬剤マスタ");
  ok("薬剤マスタが作られる", !!sh);
  eq("薬剤名の列", sh.getRange(2, 3).getValue(), "パレード20フロアブル");

  const all = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("pull に薬剤が乗る", [all.chems.length, all.chems[0].use, all.chems[0].form, all.chems[0].maxUse],
     [1, "fungicide", "sc", 3]);

  // 古い編集は踏み潰さない(圃場・作業と同じ規則)
  const older = Object.assign({}, C1, { form: "wp", updatedAt: "2026-07-01T00:00:00.000Z" });
  const r2 = post(ctx, { type: "pushChems", team: TEAM, items: [older] });
  eq("古い編集は見送る", [r2.updated, r2.skipped], [0, 1]);

  // 削除は行を消さず「削除」の印を立てて配る
  const tomb = { id: C1.id, name: "", deleted: true,
                 updatedAt: "2026-09-01T00:00:00.000Z", by: "藤本", deviceId: "dev-2" };
  post(ctx, { type: "pushChems", team: TEAM, items: [tomb] });
  const after = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("削除が配られる", [after.chems.length, after.chems[0].deleted], [1, true]);

  const other = post(ctx, { type: "pull", team: "team-b", since: "" });
  eq("別チームには配らない", other.chems.length, 0);
}

// ── 14. 作業の中身(その日の予定)を配れるか ──
{
  const ctx = makeContext({});
  const W = {
    id: 5001, workDate: "2026-08-26", fieldId: 1001, fieldName: "北の田",
    status: "mixed", plannedL: 12, sprayedL: 0, reportAreaA: "",
    chemCount: 2, chemText: "A(20倍) / B(1000倍)",
    crop: "キャベツ", areaA: 12.5,
    chems: [{ id: "c1", name: "A", ratio: 20, form: "sc" }, { id: "c2", name: "B", ratio: 1000, form: "wp" }],
    totalL: 12, waterMl: 11400, memo: "風に注意", seq: 2,
    by: "藤本", deviceId: "dev-1", updatedAt: "2026-08-26T01:00:00.000Z",
  };
  const r = post(ctx, { type: "pushWorks", team: TEAM, items: [W] });
  eq("pushWorks 追加件数", [r.ok, r.added], [true, 1]);

  const all = post(ctx, { type: "pull", team: TEAM, since: "" });
  ok("pull に plan の印が付く", all.plan === true);
  const w = all.works[0];
  eq("薬剤の中身が戻る", w.chems, W.chems);
  eq("作物・面積・並び順", [w.crop, w.areaA, w.seq], ["キャベツ", 12.5, 2]);
  eq("総量・水量・備考", [w.totalL, w.waterMl, w.memo], [12, 11400, "風に注意"]);
  eq("要約列はこれまでどおり", [w.status, w.plannedL, w.chemCount], ["mixed", 12, 2]);

  // 薬剤JSONが壊れていても、その行だけ空になって pull 全体は通る
  const sh = ctx.SHEET_STATE.getSheetByName("作業");
  sh.getRange(2, 20).setValue("{壊れ");
  const again = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("壊れた薬剤JSONは空配列にする", [again.ok, again.works[0].chems], [true, []]);
}

// ── 14b. チームが違えば、同じIDでも別の行 ─────────────
// v8.73 で作業IDを「日付＋圃場ID」から決めたため、別のチームが
// 同じ日に同じ圃場を入れるとIDが一致する。行をIDだけで探していると
// 互いの行を上書きし、チーム欄ごと奇麗に入れ替わる。
// 端末のチームコードを変えたときも同じことが起きる(実測で確認済み)。
{
  const ctx = makeContext({});
  const mk = (id, name) => ({
    id, workDate: "2026-08-26", fieldId: 1001, fieldName: name,
    status: "planned", plannedL: 0, sprayedL: 0, reportAreaA: "",
    chemCount: 0, chemText: "", crop: "", areaA: 10, chems: [],
    totalL: 0, waterMl: 0, memo: "", seq: 0, by: "x", deviceId: "d",
    reportedAt: "", updatedAt: "2026-08-26T01:00:00.000Z",
  });
  post(ctx, { type: "pushWorks", team: "Jupiter", items: [mk(777, "\u5609\u5cf61")] });
  post(ctx, { type: "pushWorks", team: "Saturn", items: [mk(777, "\u6ce2\u91ce1")] });

  const jup = post(ctx, { type: "pull", team: "Jupiter", since: "" });
  const sat = post(ctx, { type: "pull", team: "Saturn", since: "" });
  eq("チーム Jupiter の作業は1件", jup.works.length, 1);
  eq("チーム Saturn の作業は1件", sat.works.length, 1);
  eq("Jupiter の中身が残っている", (jup.works[0] || {}).fieldName, "\u5609\u5cf61");
  eq("Saturn の中身が残っている", (sat.works[0] || {}).fieldName, "\u6ce2\u91ce1");
  const prJ = post(ctx, { type: "progress", team: "Jupiter", date: "2026-08-26" });
  const prS = post(ctx, { type: "progress", team: "Saturn", date: "2026-08-26" });
  eq("進捗もチームごとに1件ずつ", [prJ.items.length, prS.items.length], [1, 1]);
}

// ── 14c. シートの行数上限(既定1000行)に当たっても送信できる ──
// 実データが 999行/1000行 まで埋まっていた。この状態では
// getRange が範囲外になり、送信が丸ごと例外で落ちる。
// 進捗の送信は「新しい作業＋削除の墓標」を一緒に送るので、
// 削除まで道連れで失敗し、進捗地図が赤いまま戻らなくなっていた。
{
  const ctx = makeContext({});
  const mk = (id, date, fid) => ({
    id, workDate: date, fieldId: fid, fieldName: "圃場" + fid,
    status: "planned", plannedL: 0, sprayedL: 0, reportAreaA: "",
    chemCount: 0, chemText: "", crop: "", areaA: 10, chems: [],
    totalL: 0, waterMl: 0, memo: "", seq: 0, by: "x", deviceId: "d",
    reportedAt: "", updatedAt: "2026-08-27T01:00:00.000Z",
  });
  const tomb = id => ({ id, deleted: true, updatedAt: "2026-08-28T00:00:00.000Z",
    fieldId: 0, workDate: "", status: "planned", by: "x", deviceId: "d" });

  for (let b = 0; b < 999; b += 300) {
    const items = [];
    for (let k = b; k < Math.min(b + 300, 999); k++) items.push(mk(100000 + k, "2026-08-27", 5000 + k));
    post(ctx, { type: "pushWorks", team: "Jupiter", items });
  }
  const sh = ctx.getWorkSheet_();
  eq("埋めた行数は999", sh.getLastRow() - 1, 999);

  const r1 = post(ctx, { type: "pushWorks", team: "Jupiter", items: [mk(999999, "2026-08-28", 7777)] });
  eq("満杯でも新規を受け付ける", r1.ok, true);
  eq("シートが伸びている", sh.getMaxRows() > 1000, true);

  // 「新規＋墓標」をまとめて送る形(pushProgress と同じ)
  const r2 = post(ctx, { type: "pushWorks", team: "Jupiter",
    items: [mk(888888, "2026-08-28", 8888), tomb(100001)] });
  eq("新規＋墓標をまとめて送れる", r2.ok, true);
  const pr = post(ctx, { type: "progress", team: "Jupiter", from: "2026-08-27", to: "2026-08-27" });
  eq("墓標が効いている", pr.items.some(x => String(x.id) === "100001"), false);
  eq("進捗は作業IDを返す", pr.items.length > 0 && pr.items[0].id !== undefined, true);
}

// ── 14d. 30日を過ぎた削除済みの行を捨てる ────────────────
// 削除しても行は残る(墓標)ので、放っておくと増え続ける。
// 実データでは 999行中 354行 が中身の空いた削除済みの行だった。
// ただし早く捨てすぎると、長く同期していない端末に削除が伝わらない。
{
  const ctx = makeContext({});
  const mk = (id, upd) => ({
    id, workDate: "2026-08-27", fieldId: 6000 + id, fieldName: "圃場",
    status: "planned", plannedL: 0, sprayedL: 0, reportAreaA: "",
    chemCount: 0, chemText: "", crop: "", areaA: 10, chems: [],
    totalL: 0, waterMl: 0, memo: "", seq: 0, by: "x", deviceId: "d",
    reportedAt: "", updatedAt: upd,
  });
  post(ctx, { type: "pushWorks", team: "Jupiter", items: [mk(1, "2026-08-01T00:00:00.000Z"), mk(2, "2026-08-01T00:00:00.000Z")] });
  const sh = ctx.getWorkSheet_();
  const atCol = 16;  // 更新日時(1始まり)
  const delCol = 17; // 削除(1始まり)

  // 1件を削除し、更新日時を 100日前に偽装する
  post(ctx, { type: "pushWorks", team: "Jupiter",
    items: [{ id: 1, deleted: true, updatedAt: "2026-08-27T00:00:00.000Z", fieldId: 0, workDate: "", status: "planned", by: "x", deviceId: "d" }] });
  eq("削除しても行は残る", sh.getLastRow() - 1, 2);
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  sh.getRange(2, atCol, 1, 1).setValues([[old]]);
  eq("削除の印が立っている", !!sh.getRange(2, delCol, 1, 1).getValues()[0][0], true);

  // 次の送信で掃除される
  const r = post(ctx, { type: "pushWorks", team: "Jupiter", items: [mk(3, "2026-08-27T02:00:00.000Z")] });
  eq("掃除件数を返す", r.purged, 1);
  eq("行が減っている", sh.getLastRow() - 1, 2);
  const ids = [];
  sh.getRange(2, 1, 2, 1).getValues().forEach(x => ids.push(String(x[0])));
  eq("残ったのは2と3", ids.sort().join(","), "2,3");

  // まだ新しい墓標は捨てない
  post(ctx, { type: "pushWorks", team: "Jupiter",
    items: [{ id: 2, deleted: true, updatedAt: "2026-08-27T03:00:00.000Z", fieldId: 0, workDate: "", status: "planned", by: "x", deviceId: "d" }] });
  const r2 = post(ctx, { type: "pushWorks", team: "Jupiter", items: [mk(4, "2026-08-27T04:00:00.000Z")] });
  eq("新しい墓標は残す", r2.purged, 0);
}

// ── 15. 作業日がシート側で日付に化けても、文字列で返す ──
// スプレッドシートは "2026-08-26" を Date として解釈する。そのまま String() すると
// "Wed Aug 26 2026 ..." になり、アプリの「その日の作業」に一致しなくなって
// 本日の圃場が一覧から消える。gasharness はこの解釈を再現している。
{
  const ctx = makeContext({});
  const W = {
    id: 7001, workDate: "2026-08-26", fieldId: 1001, fieldName: "北の田",
    status: "done", plannedL: 10, sprayedL: 10, reportAreaA: 12,
    chemCount: 0, chemText: "", crop: "", areaA: 12, chems: [],
    totalL: 10, waterMl: 0, memo: "", seq: 0,
    by: "藤本", deviceId: "dev-1",
    reportedAt: "2026-08-26", updatedAt: "2026-08-26T01:00:00.000Z",
  };
  post(ctx, { type: "pushWorks", team: TEAM, items: [W] });

  const sh = ctx.SHEET_STATE.getSheetByName("作業");
  // 作業日の列は "@"(文字列)書式に固定してあるので、シートは日付として解釈しない。
  // 書式を当てていない列では実際に Date になる(下の「防除記録の散布日」で確認)。
  eq("書式を固定した列は文字列のまま", sh.getRange(2, 3).getValue(), "2026-08-26");

  const all = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("pull の作業日は yyyy-MM-dd", all.works[0].workDate, "2026-08-26");
  eq("pull の実績入力日時も同じ", all.works[0].reportedAt, "2026-08-26");

  const pr = post(ctx, { type: "progress", team: TEAM, date: "2026-08-26" });
  eq("progress も日付で絞り込める", [pr.ok, pr.items.length], [true, 1]);
  const none = post(ctx, { type: "progress", team: TEAM, date: "2026-08-27" });
  eq("別の日には出ない", none.items.length, 0);
  // 実績入力日も yyyy-MM-dd で返す。String(Date) のままだと
  // 進捗地図の吹き出しに "Thu Aug 27 2026 ..." が出る
  eq("progress の実績入力日も yyyy-MM-dd", pr.items[0].at, "2026-08-26");
  // r[13] が空のときは更新日時で代用するが、それも日付の形にする
  {
    const sh2 = ctx.SHEET_STATE.getSheetByName("作業");
    sh2.getRange(2, 14).setValue("");
    const pr2 = post(ctx, { type: "progress", team: TEAM, date: "2026-08-26" });
    eq("progress 実績入力日が空なら更新日時を日付で返す", /^\d{4}-\d{2}-\d{2}$/.test(pr2.items[0].at), true);
  }
}

// ── 15b. 実績入力の「刻」(v8.97) ──
// 同じ日に2人が同じ圃場を済ませたとき、どちらが先かを
// 日付だけでは決められない。刻まで入った値を別に返す。
{
  const ctx = makeContext({});
  const T = "2026-08-26T02:34:56.000Z";
  post(ctx, { type: "pushWorks", team: TEAM, items: [{
    id: 900, workDate: "2026-08-26", fieldId: 1, fieldName: "A", status: "done",
    sprayedL: 20, chems: [], by: "Aさん",
    reportedAt: T, updatedAt: "2026-08-26T03:00:00.000Z",
  }] });

  const sh = ctx.SHEET_STATE.getSheetByName("作業");
  // 列 14(実績入力日時)の書式を固定していないと、シートが ISO を
  // Date に変換してタイムゾーンがずれる。v8.96 までは抜けていた
  // Date と ISO 文字列は JSON にすると同じに見えるので、型も見る。
  // これが無いと、書式を外しても検査が通ってしまう
  eq("実績入力日時の列は文字列のまま", sh.getRange(2, 14).getValue(), T);
  eq("実績入力日時の列は Date にされない", typeof sh.getRange(2, 14).getValue(), "string");

  const pr = post(ctx, { type: "progress", team: TEAM, date: "2026-08-26" });
  eq("progress は刻まで入った値も返す", pr.items[0].atTime, T);
  eq("日付のほうは丸めたまま", pr.items[0].at, "2026-08-26");
  eq("記録者名も返す", pr.items[0].by, "Aさん");

  const all = post(ctx, { type: "pull", team: TEAM, since: "" });
  eq("pull の実績入力日は日付のまま", all.works[0].reportedAt, "2026-08-26");
  eq("pull は刻まで入った値も返す", all.works[0].reportedAtTime, T);

  // 日付しか入っていない古い行でも落ちない
  {
    const sh2 = ctx.SHEET_STATE.getSheetByName("作業");
    sh2.getRange(2, 14).setValue("2026-08-26");
    const pr2 = post(ctx, { type: "progress", team: TEAM, date: "2026-08-26" });
    eq("古い行は日付がそのまま刻の位置に入る", pr2.items[0].atTime, "2026-08-26");
  }
}

// ── 15c. 読み取るセルを絞る(v8.98) ──
// 進捗も差分取得も、毎回作業シートを丸ごと読んでいた。
// 鍵の列を1本だけ先に読んで、要る行の範囲だけを取る。
{
  const ctx = makeContext({});
  const DAYS = 12, N = 20;
  let id = 1;
  const dates = [];
  for (let d = 0; d < DAYS; d++) {
    const ymd = new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);
    dates.push(ymd);
    const items = [];
    for (let f = 1; f <= N; f++) items.push({
      id: id++, workDate: ymd, fieldId: f, fieldName: "圃場" + f,
      status: f % 2 ? "done" : "planned", sprayedL: 10, reportAreaA: 12,
      chems: [], by: "藤本", reportedAt: ymd + "T02:00:00.000Z",
      updatedAt: ymd + "T02:00:00.000Z"
    });
    post(ctx, { type: "pushWorks", team: TEAM, items: items });
  }
  const sh = ctx.SHEET_STATE.getSheetByName("作業");
  const rows = sh.getLastRow() - 1;
  const full = rows * 24; // 作業シートの列数
  eq("下抵えの行数", rows, DAYS * N);

  // 直近3日
  const from = dates[DAYS - 3], to = dates[DAYS - 1];
  sh._readCells = 0;
  const pr = post(ctx, { type: "progress", team: TEAM, from: from, to: to });
  const progCells = sh._readCells;
  eq("範囲の件数は変わらない", pr.items.length, 3 * N);
  eq("範囲外は入らない", pr.items.every(x => x.workDate >= from && x.workDate <= to), true);
  ok("進捗は全行読みより少ないセルで済む (" + progCells + " < " + full + ")",
    progCells < full * 0.6);

  // 変化が無いときの差分取得
  sh._readCells = 0;
  const pu = post(ctx, { type: "pull", team: TEAM, since: new Date().toISOString() });
  const pullCells = sh._readCells;
  eq("変化が無ければ何も返さない", pu.works.length, 0);
  // 日時の列 rows セル + 見出し行の確認(列数分)。行本体は1行も読まない。
  // 列を足すたびにここの数字を直すのを避けるため、見出しから引く
  const headCells = ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("作業").getLastColumn();
  ok("変化が無いときは日時の列と見出しだけで済む (" + pullCells + " ≤ " + (rows + headCells) + ")",
    pullCells <= rows + headCells);

  // 変化があれば拾う(絞っても取りこぼさない)
  post(ctx, { type: "pushWorks", team: TEAM, items: [{
    id: 5, workDate: dates[0], fieldId: 5, fieldName: "圃場5", status: "done",
    sprayedL: 99, chems: [], updatedAt: "2099-01-01T00:00:00.000Z"
  }] });
  const pu2 = post(ctx, { type: "pull", team: TEAM, since: "2026-01-01T00:00:00.000Z" });
  eq("先頭の行を直しても差分に出る", pu2.works.some(w => w.id === 5 && w.sprayedL === 99), true);

  // 範囲に1件も無いとき
  const none = post(ctx, { type: "progress", team: TEAM, from: "2020-01-01", to: "2020-01-02" });
  eq("範囲外なら空", none.items.length, 0);

  // 日付が逆順で入っても拾う(追記順とは限らない)
  post(ctx, { type: "pushWorks", team: TEAM, items: [{
    id: 9001, workDate: dates[DAYS - 1], fieldId: 99, fieldName: "あとから入った",
    status: "done", sprayedL: 1, chems: [], updatedAt: "2099-01-02T00:00:00.000Z"
  }] });
  const pr2 = post(ctx, { type: "progress", team: TEAM, from: from, to: to });
  eq("あとから末尾に追記された行も拾う", pr2.items.some(x => x.fieldId === 99), true);
}

// ── 15d. 台帳へのまとめ送り(v8.98) ──
{
  const ctx = makeContext({});
  const R = (id, o) => Object.assign({ id, date: "2026-08-26", field: "圃場" + id,
    crop: "水稲", areaA: 10, totalL: 5, waterMl: 5000, chems: [] }, o || {});

  const j = post(ctx, { type: "pushRecords", team: TEAM, recorder: "藤本", items: [
    { op: "record", record: R(1) },
    { op: "record", record: R(2) },
    { op: "report", record: R(1, { sprayedL: 12, reportDate: "2026-08-26" }) }
  ] });
  eq("まとめ送りは件数分の結果を返す", [j.ok, (j.results || []).length], [true, 3]);
  eq("全部成功", (j.results || []).length === 3 && j.results.every(r => r.ok), true);

  const sh = ctx.SHEET_STATE.getSheetByName("防除記録");
  eq("行は2本だけ(report は既存行を更新)", sh.getLastRow() - 1, 2);
  eq("実散布量が入る", sh.getRange(2, 12).getValue(), 12);
  eq("状態が散布済", sh.getRange(2, 13).getValue(), "散布済");
  eq("チームも入る", sh.getRange(2, 16).getValue(), TEAM);

  // 順番が守られること。取り消し→再報告 を同じ回で送る
  const j2 = post(ctx, { type: "pushRecords", team: TEAM, recorder: "藤本", items: [
    { op: "unreport", record: R(1) },
    { op: "report", record: R(1, { sprayedL: 33, reportDate: "2026-08-27" }) }
  ] });
  eq("2件とも成功", (j2.results || []).length === 2 && j2.results.every(r => r.ok), true);
  eq("あとに送った報告が残る(取り消しが勝たない)", sh.getRange(2, 12).getValue(), 33);

  // 逆に並べると取り消しが勝つ(順番に意味があることの確認)
  post(ctx, { type: "pushRecords", team: TEAM, items: [
    { op: "report", record: R(1, { sprayedL: 99, reportDate: "2026-08-28" }) },
    { op: "unreport", record: R(1) }
  ] });
  eq("順を逆にすると取り消しが勝つ", sh.getRange(2, 12).getValue(), "");

  // 壊れた件が混ざっても、他の件は通る
  const j3 = post(ctx, { type: "pushRecords", team: TEAM, items: [
    { op: "record", record: { id: "" } },
    { op: "record", record: R(3) }
  ] });
  eq("壊れた件だけ失敗する", (j3.results || []).map(r => r.ok), [false, true]);
  eq("他の件は行になる", sh.getLastRow() - 1, 3);

  eq("team は必須", post(ctx, { type: "pushRecords", items: [] }).error, "team required");
  eq("items は必須", post(ctx, { type: "pushRecords", team: TEAM }).error, "items required");
  eq("多すぎれば断る",
    post(ctx, { type: "pushRecords", team: TEAM, items: new Array(400).fill({ op: "record", record: R(9) }) }).error, "too many");

  // 1件ずつの古い道も残っていること(アプリだけ更新した人のため)
  const ctx2 = makeContext({});
  const s1 = post(ctx2, { type: "record", team: TEAM, recorder: "藤本", record: R(7) });
  eq("record 単体は今までどおり", [s1.ok, s1.added], [true, 1]);
  const s2 = post(ctx2, { type: "report", team: TEAM, record: R(7, { sprayedL: 8, reportDate: "2026-08-26" }) });
  eq("report 単体も今までどおり", [s2.ok, s2.updated], [true, 1]);
  const s3 = post(ctx2, { type: "unreport", team: TEAM, record: R(7) });
  eq("unreport 単体も今までどおり", [s3.ok, s3.updated], [true, 1]);
  eq("実績が消える", ctx2.SHEET_STATE.getSheetByName("防除記録").getRange(2, 12).getValue(), "");
}

// ── 16. doGet ──
{
  const ctx = makeContext({ SHARED_SECRET: "x" });
  const g = JSON.parse(ctx.doGet().getContent());
  eq("doGet secured", [g.ok, g.secured], [true, true]);
  ok("features に progress が入る", g.features.indexOf("progress") >= 0);
  ok("features に pushFields が入る", g.features.indexOf("pushFields") >= 0);
  ok("features に pushChems が入る", g.features.indexOf("pushChems") >= 0);
  ok("features に workPlan が入る", g.features.indexOf("workPlan") >= 0);
  ok("features に unreport が入る", g.features.indexOf("unreport") >= 0);
}

// ── 17. 防除記録シートのチーム分離(v8.85) ──
{
  const ctx = makeContext({});
  // 作業IDは「日付＋圃場ID」で決まるので、別チームでも同じ記録IDになりうる
  const rec = {
    id: "2026-08-20:1001", date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: [{ name: "薬剤A", ratio: 1000, ml: 100 }],
    totalL: 100, waterMl: 99900, memo: "",
  };
  const sh = ctx.SHEET_STATE.getSheetByName.bind(ctx.SHEET_STATE);
  post(ctx, { type: "record", team: "team-a", recorder: "藤本", record: rec });
  const r = post(ctx, { type: "record", team: "team-b", recorder: "田中",
                        record: Object.assign({}, rec, { field: "南の田" }) });
  const s17 = sh("防除記録");
  eq("同じ記録IDでもチームが違えば別の行になる", [r.ok, r.added, s17.getLastRow()], [true, 1, 3]);
  eq("チームコード列に書かれる",
     [s17.getRange(2, 16).getValue(), s17.getRange(3, 16).getValue()], ["team-a", "team-b"]);
  eq("見出しの末尾はチームコード", s17.getRange(1, 16).getValue(), "チームコード");

  // 報告は自分のチームの行だけを更新する
  post(ctx, { type: "report", team: "team-b", recorder: "田中",
              record: Object.assign({}, rec, { sprayedL: 95, reportDate: "2026-08-20" }) });
  eq("team-a の行は触られない", s17.getRange(2, 13).getValue(), "調合済");
  eq("team-b の行だけ散布済になる", s17.getRange(3, 13).getValue(), "散布済");
  eq("行は増えない", s17.getLastRow(), 3);
}

// ── 18. チーム欄が空の既存行(v8.84以前)の扱い ──
{
  const ctx = makeContext({});
  const rec = {
    id: 9002, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: [{ name: "薬剤A", ratio: 1000, ml: 100 }],
    totalL: 100, waterMl: 99900, memo: "",
  };
  // team を送らない旧アプリからの記録 = チーム欄が空の行になる
  post(ctx, { type: "record", recorder: "藤本", record: rec });
  const sh = ctx.SHEET_STATE.getSheetByName("防除記録");
  eq("旧アプリの行はチーム欄が空", sh.getRange(2, 16).getValue(), "");

  // 新アプリから報告すると、その行を拾って更新し、チームを書き戻す
  const r = post(ctx, { type: "report", team: "team-a", recorder: "藤本",
                        record: Object.assign({}, rec, { sprayedL: 95, reportDate: "2026-08-20" }) });
  eq("空の行を拾って更新する(二重行にしない)", [r.ok, r.updated, sh.getLastRow()], [true, 1, 2]);
  eq("拾った行にチームが書き戻される", sh.getRange(2, 16).getValue(), "team-a");
  eq("状態が散布済になる", sh.getRange(2, 13).getValue(), "散布済");

  // 書き戻した後は、別チームからは見えない
  const r2 = post(ctx, { type: "report", team: "team-b", recorder: "田中",
                         record: Object.assign({}, rec, { sprayedL: 80, reportDate: "2026-08-21" }) });
  eq("移行後は別チームには拾われず新規行になる", [r2.ok, r2.added, sh.getLastRow()], [true, 1, 3]);
}

// ── 19. 旧アプリ(team なし)は従来どおり動く ──
{
  const ctx = makeContext({});
  const rec = {
    id: 9003, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: [{ name: "薬剤A", ratio: 1000, ml: 100 }],
    totalL: 100, waterMl: 99900, memo: "",
  };
  post(ctx, { type: "record", recorder: "藤本", record: rec });
  const r = post(ctx, { type: "report", recorder: "藤本",
                        record: Object.assign({}, rec, { sprayedL: 95, reportDate: "2026-08-20" }) });
  const sh = ctx.SHEET_STATE.getSheetByName("防除記録");
  eq("team なしでも既存行を更新する", [r.ok, r.updated, sh.getLastRow()], [true, 1, 2]);
  const u = post(ctx, { type: "unreport", recorder: "藤本", record: rec });
  eq("team なしでも取り消せる", [u.ok, u.updated], [true, 1]);
}

// ── 20. 更新日時が Date に化けても since が効く(v8.85) ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM, items: [F1, F2] });
  const sh = ctx.SHEET_STATE.getSheetByName("圃場マスタ");

  // 書式を固定していない版で書かれた既存シートを模す。更新日時が Date で入っている。
  // String() すると "Wed Aug 26 2026 ..." になり、ISO との辞書順比較が壊れる。
  const at = new Date("2026-08-01T00:00:00.000Z");
  sh.rows[1][10] = at;               // 2行目の更新日時(0始まりで列10)
  ok("張りぼてで Date に化けている", sh.getRange(2, 11).getValue() instanceof Date);

  const after = post(ctx, { type: "pull", team: TEAM, since: "2026-08-02T00:00:00.000Z" });
  const ids = after.fields.map(f => String(f.id));
  eq("化けた行も since より古ければ配らない", ids.indexOf("1001"), -1);

  const before = post(ctx, { type: "pull", team: TEAM, since: "2026-07-01T00:00:00.000Z" });
  ok("since より新しければ配る", before.fields.map(f => String(f.id)).indexOf("1001") >= 0);
  eq("serverAt も ISO に戻して返す",
     before.fields.filter(f => String(f.id) === "1001")[0].serverAt, at.toISOString());
}

// ── 21. 更新日時の列は文字列書式に固定されている(v8.85) ──
{
  const ctx = makeContext({});
  post(ctx, { type: "pushFields", team: TEAM, items: [F1] });
  post(ctx, { type: "pushChems", team: TEAM, items: [
    { id: "薬剤A", name: "薬剤A", use: "殺菌剤", form: "フロアブル", maxUse: 3,
      updatedAt: "2026-08-01T00:00:00.000Z", by: "藤本", deviceId: "dev-1" },
  ] });
  const f = ctx.SHEET_STATE.getSheetByName("圃場マスタ");
  const c = ctx.SHEET_STATE.getSheetByName("薬剤マスタ");
  eq("圃場マスタの更新日時は文字列のまま",
     typeof f.getRange(2, 11).getValue(), "string");
  eq("薬剤マスタの更新日時は文字列のまま",
     typeof c.getRange(2, 8).getValue(), "string");
  // 書式を当てていない列は、実物どおり Date になる(張りぼてが手加減していない証拠)
  const rec = {
    id: 9101, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12,
    chems: [], totalL: 10, waterMl: 0, memo: "",
  };
  post(ctx, { type: "record", team: TEAM, recorder: "藤本", record: rec });
  ok("防除記録の散布日は Date になる",
     ctx.SHEET_STATE.getSheetByName("防除記録").getRange(2, 3).getValue() instanceof Date);
}

// ── 22. pull の基準時刻はずらして返す(v8.85) ──
{
  const ctx = makeContext({});
  const lag = ctx.read("PULL_LAG_MS");
  eq("ずらし幅は2分", lag, 120000);

  post(ctx, { type: "pushFields", team: TEAM, items: [F1] });
  const before = Date.now();
  const r = post(ctx, { type: "pull", team: TEAM, since: "" });
  const st = new Date(r.serverTime).getTime();
  ok("serverTime は今より前", st <= before);
  ok("ずらし幅ぶん手前になっている", before - st >= lag - 2000);
  ok("ずらしすぎていない", before - st <= lag + 5000);

  // 押し込みと pull が重なったときに取りこぼさないこと。
  // 「pull が基準時刻を採った後に、それより古い更新日時で行が載る」状況を作る。
  const sh = ctx.SHEET_STATE.getSheetByName("圃場マスタ");
  const lateAt = new Date(Date.now() - 30000).toISOString();  // 30秒前 = 基準時刻より後
  sh.getRange(2, 11).setValue(lateAt);
  const next = post(ctx, { type: "pull", team: TEAM, since: r.serverTime });
  eq("基準時刻より後に載った行は次回配られる", next.fields.length, 1);

  // 幅を超えて古い行は、既に配り終えたものとして配らない
  sh.getRange(2, 11).setValue(new Date(Date.now() - lag - 60000).toISOString());
  const old = post(ctx, { type: "pull", team: TEAM, since: r.serverTime });
  eq("幅より古い行は配り直さない", old.fields.length, 0);
}

// ── 20. 台帳を作業シートから作れるか(提案D・第2段) ──────────
// 「防除記録」シートの列は全部「作業」シートにもある。最後に残っていた
// 実績メモも v9.04 で足した。ここでは、いつもの送り方(pushWorks + record +
// report)で入れたあと、作業シートから作り直した台帳が今の台帳と
// 一致することを確かめる。一致するなら record / report は要らなくなる。
{
  const ctx = makeContext({});
  const CHEMS = [{ name: "薬剤A", useName: "殺菌剤", formName: "フロアブル", ratio: 1000, ml: 100 }];
  const CHEM_TEXT = "薬剤A(殺菌剤・フロアブル・1000倍・100mL)";
  const ID = 9101;
  const W = {
    id: ID, workDate: "2026-08-20", fieldId: 3, fieldName: "北の田",
    status: "done", plannedL: 100, sprayedL: 95, reportAreaA: 12.5,
    chemCount: 1, chemText: CHEM_TEXT, crop: "水稲", areaA: 12.5,
    chems: CHEMS, totalL: 100, waterMl: 99900, memo: "予定のメモ",
    reportMemo: "実際は少なめ", seq: 0, by: "藤本", deviceId: "d1",
    reportedAt: "2026-08-20T04:00:00.000Z",
    updatedAt: "2026-08-20T04:00:00.000Z",
  };
  post(ctx, { type: "pushWorks", team: TEAM, items: [W] });
  // 実績メモが往復すること(この列が無いと台帳の備考が作れない)
  eq("実績メモが戻る",
     post(ctx, { type: "pull", team: TEAM, since: "" }).works[0].reportMemo, "実際は少なめ");

  const rec = {
    id: ID, date: "2026-08-20", field: "北の田", crop: "水稲", areaA: 12.5,
    chems: CHEMS, totalL: 100, waterMl: 99900, memo: "予定のメモ",
  };
  post(ctx, { type: "record", team: TEAM, recorder: "藤本", record: rec });
  post(ctx, { type: "report", team: TEAM, recorder: "藤本",
              record: Object.assign({}, rec, {
                sprayedL: 95, reportDate: "2026-08-20",
                reportAreaA: 12.5, reportMemo: "実際は少なめ" }) });

  const c = post(ctx, { type: "ledgerCheck", team: TEAM });
  eq("作業シートから作った台帳が今の台帳と一致する",
     [c.ok, c.same, c.differ, c.onlyWork, c.onlyLedger, c.sample],
     [true, 1, 0, 0, 0, []]);

  // 台帳を手で書き換えたら気づくこと(気づかないなら照合の意味がない)
  const lg = ctx.SHEET_STATE.getSheetByName("防除記録");
  lg.getRange(2, 12).setValue(999);            // 実散布量
  const c2 = post(ctx, { type: "ledgerCheck", team: TEAM });
  eq("違いがあれば拾う", [c2.same, c2.differ], [0, 1]);
  eq("どの列が違うかまで出す",
     [c2.sample[0].why, c2.sample[0].made, c2.sample[0].ledger],
     ["実散布量(L)", "95", "999"]);
  lg.getRange(2, 12).setValue(95);

  // 台帳にだけある行(古い版で入れた記録など)は「作業シートに無い」と出す
  lg.appendRow(["", "9999", "2026-08-01", "藤本", "昔の田", "", "", 0, "", 0, 0, "", "調合済", "", "", TEAM]);
  const c3 = post(ctx, { type: "ledgerCheck", team: TEAM });
  eq("台帳にだけある行は数える", [c3.same, c3.onlyLedger], [1, 1]);
  eq("その行の理由", c3.sample[0].why, "作業シートに無い");

  // 実績を取り消したら、作り直した台帳も「調合済」に戻ること
  post(ctx, { type: "unreport", team: TEAM, recorder: "藤本", record: { id: ID } });
  post(ctx, { type: "pushWorks", team: TEAM, items: [Object.assign({}, W, {
    status: "mixed", sprayedL: 0, reportAreaA: "", reportedAt: "",
    updatedAt: "2026-08-20T05:00:00.000Z" })] });
  const c4 = post(ctx, { type: "ledgerCheck", team: TEAM });
  // ここで実際に食い違いが見つかった(照合の意味があった例)。
  // unreport は実散布量と報告日は消すが、備考に入れた実績メモは消さない。
  // そのため、実績を取り消したあとも台帳には実績メモが残る。
  // 作業シートから作り直すと予定のメモになる。
  // unreport の送りものは {id} だけで、予定のメモを知らないので、
  // 台帳側だけでは直せない(消すことしかできない)。
  // 提案D を通せばこの食い違い自体がなくなるので、ここでは直さず、
  // 黙って変わらないように固めておく。
  eq("取り消し後は備考だけ食い違う(既知)",
     [c4.differ, c4.sample[0].why, c4.sample[0].made, c4.sample[0].ledger],
     [1, "備考", "予定のメモ", "実際は少なめ"]);
  // 9999 の行は作業シートに無いまま
  eq("残っているのは台帳だけの行", c4.onlyLedger, 1);
  // 状態と報告日と実散布量はちゃんと戻っている(備考だけが残る)
  eq("状態は調合済に戻る", lg.getRange(2, 13).getValue(), "調合済");

  eq("ledgerCheck は team 必須",
     post(ctx, { type: "ledgerCheck" }).error, "team required");
  eq("features に載っている",
     (JSON.parse(ctx.doGet().getContent()).features || []).indexOf("ledgerCheck") >= 0, true);
}

// ── 21. 知らない種類は「unknown type」で返す(v9.05) ──────
// v9.04 までは、知らない種類が record の中身の検査に落ちて
// 「invalid payload」になっていた。アプリ側は unknown type を
// 「動いているGASが古い」の目印にしているので、古いのに古いと分からず、
// 「送ったものが壊れている」と読める案内が出た。
// 実際に v9.04 の ledgerCheck を古いGASに送ってそうなった。
{
  const ctx = makeContext({});
  eq("知らない種類は unknown type",
     post(ctx, { type: "なんだこれ", team: TEAM }).error, "unknown type");
  // 中身が付いていても同じ。種類の判定が先
  eq("中身があっても種類が先",
     post(ctx, { type: "なんだこれ", team: TEAM,
                 record: { id: 1, chems: [] } }).error, "unknown type");
  // record の中身が足りないときはこれまでどおり
  eq("record の中身が足りなければ invalid payload",
     post(ctx, { type: "record", team: TEAM, record: { id: 1 } }).error, "invalid payload");
  eq("record 自体が無ければ invalid payload",
     post(ctx, { type: "report", team: TEAM }).error, "invalid payload");
}

// ─────────── 結果 ───────────
if (fails.length) {
  console.error("\n  ✗ " + fails.length + " 件失敗 / " + (pass + fails.length) + " 件中\n");
  fails.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log("  ✓ " + pass + " 件すべて成功");
