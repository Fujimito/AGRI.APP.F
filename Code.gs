// ════════════════════════════════════════════════════════
//  薬液調合ノート — 防除記録受信スクリプト v2(Google Apps Script)
//  調合記録の受信 + 散布完了報告(実散布量・面積・備考)の反映に対応
//
//  設置方法:
//  1. Googleスプレッドシートを新規作成(名前は自由。例:「防除記録」)
//  2. メニュー「拡張機能」→「Apps Script」を開く
//  3. 最初から入っているコードを全部消して、このファイルの内容を貼り付け
//  4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//     - 次のユーザーとして実行: 自分
//     - アクセスできるユーザー: 全員        ← ここが重要
//  5. 表示された「ウェブアプリのURL」(…/exec)をアプリの設定に貼り付け
//
//  ※既にv1を設置済みの場合:コードを差し替えて保存後、
//    「デプロイ」→「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→ デプロイ
//    (URLは変わりません)
// ════════════════════════════════════════════════════════

const SHEET_NAME = "防除記録";

const HEADERS = [
  "受信日時",       // 1
  "記録ID",         // 2
  "散布日",         // 3
  "記録者",         // 4
  "圃場",           // 5
  "作物",           // 6
  "面積(a)",        // 7
  "総量(L)",        // 8
  "水量(L)",        // 9
  "薬剤名",         // 10
  "剤型",           // 11
  "希釈倍率",       // 12
  "薬量(mL)",       // 13
  "実散布量(L)",    // 14
  "状態",           // 15  調合済 / 散布済
  "報告日",         // 16
  "備考",           // 17
];
const COL = {
  ID: 2, AREA: 7, SPRAYED: 14, STATUS: 15, REPORT_DATE: 16, MEMO: 17,
};

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#EDF5EE");
    sh.setFrozenRows(1);
  }
  return sh;
}

// 指定した記録IDの行番号一覧を返す
function findRows_(sh, recordId) {
  if (sh.getLastRow() < 2) return [];
  const ids = sh.getRange(2, COL.ID, sh.getLastRow() - 1, 1).getValues().flat();
  const rows = [];
  ids.forEach((v, i) => { if (String(v) === String(recordId)) rows.push(i + 2); });
  return rows;
}

// 記録の行データを作る(1薬剤=1行)
function buildRows_(data, status) {
  const rec = data.record;
  const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  return rec.chems.map((c) => [
    now,
    String(rec.id),
    rec.date || "",
    data.recorder || "",
    rec.field || "",
    rec.crop || "",
    rec.reportAreaA || rec.areaA || "",
    Number(rec.totalL) || 0,
    Math.round(Number(rec.waterMl) || 0) / 1000, // mL→L
    c.name || "",
    c.formName || "",
    c.ratio || "",
    Math.round(Number(c.ml) || 0),
    status === "散布済" ? (Number(rec.sprayedL) || "") : "",
    status,
    status === "散布済" ? (rec.reportDate || "") : "",
    (status === "散布済" ? (rec.reportMemo || rec.memo) : rec.memo) || "",
  ]);
}

// ── 受信(アプリからのPOST) ──
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const rec = data.record;
    if (!rec || !rec.id || !Array.isArray(rec.chems)) {
      return json_({ ok: false, error: "invalid payload" });
    }
    const sh = getSheet_();
    const type = data.type || "record";
    const existing = findRows_(sh, rec.id);

    if (type === "record") {
      // 調合記録の新規受信(再送による二重登録は防止)
      if (existing.length > 0) return json_({ ok: true, duplicated: true });
      const rows = buildRows_(data, "調合済");
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      return json_({ ok: true, added: rows.length });
    }

    if (type === "report") {
      // 散布完了報告:既存の行に実散布量・状態・報告日・備考を反映
      if (existing.length > 0) {
        existing.forEach((row) => {
          sh.getRange(row, COL.SPRAYED).setValue(Number(rec.sprayedL) || "");
          sh.getRange(row, COL.STATUS).setValue("散布済");
          sh.getRange(row, COL.REPORT_DATE).setValue(rec.reportDate || "");
          if (rec.reportAreaA) sh.getRange(row, COL.AREA).setValue(rec.reportAreaA);
          if (rec.reportMemo) sh.getRange(row, COL.MEMO).setValue(rec.reportMemo);
        });
        return json_({ ok: true, updated: existing.length });
      }
      // 元の記録が見つからない場合は報告内容ごと新規追加(取りこぼし防止)
      const rows = buildRows_(data, "散布済");
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      return json_({ ok: true, added: rows.length });
    }

    return json_({ ok: false, error: "unknown type" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ── 接続テスト(アプリの「接続テスト」ボタンからのGET) ──
function doGet() {
  return json_({ ok: true, app: "薬液調合ノート 受信口 v2", sheet: SHEET_NAME });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
