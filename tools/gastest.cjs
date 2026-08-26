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

// ── 13. doGet ──
{
  const ctx = makeContext({ SHARED_SECRET: "x" });
  const g = JSON.parse(ctx.doGet().getContent());
  eq("doGet secured", [g.ok, g.secured], [true, true]);
  ok("features に progress が入る", g.features.indexOf("progress") >= 0);
  ok("features に pushFields が入る", g.features.indexOf("pushFields") >= 0);
  ok("features に unreport が入る", g.features.indexOf("unreport") >= 0);
}

// ─────────── 結果 ───────────
if (fails.length) {
  console.error("\n  ✗ " + fails.length + " 件失敗 / " + (pass + fails.length) + " 件中\n");
  fails.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log("  ✓ " + pass + " 件すべて成功");
