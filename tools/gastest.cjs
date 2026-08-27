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

  const none = post(ctx, { type: "pull", team: TEAM, since: all.serverTime });
  eq("pull since 以降は0件", none.fields.length, 0);

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
  ok("シート側では日付になっている", sh.getRange(2, 3).getValue() instanceof Date);

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

// ─────────── 結果 ───────────
if (fails.length) {
  console.error("\n  ✗ " + fails.length + " 件失敗 / " + (pass + fails.length) + " 件中\n");
  fails.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log("  ✓ " + pass + " 件すべて成功");
