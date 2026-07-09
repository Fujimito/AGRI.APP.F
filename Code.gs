// ════════════════════════════════════════════════════════
//  薬液調合ノート — 防除記録受信スクリプト(Google Apps Script)
//
//  設置方法:
//  1. Googleスプレッドシートを新規作成(名前は自由。例:「防除記録」)
//  2. メニュー「拡張機能」→「Apps Script」を開く
//  3. 最初から入っているコードを全部消して、このファイルの内容を貼り付け
//  4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//     - 説明: 任意(例: v1)
//     - 次のユーザーとして実行: 自分
//     - アクセスできるユーザー: 全員        ← ここが重要
//  5. 「デプロイ」を押し、表示された「ウェブアプリのURL」
//     (https://script.google.com/macros/s/…/exec)をコピー
//  6. アプリの「記録」タブ →「設定」→ 送信先URLに貼り付け →「接続テスト」
// ════════════════════════════════════════════════════════

const SHEET_NAME = "防除記録";

const HEADERS = [
  "受信日時", "記録ID", "散布日", "記録者", "圃場",
  "総量(L)", "水量(L)", "薬剤名", "剤型", "希釈倍率", "薬量(mL)",
];

// シートを取得(なければヘッダー付きで作成)
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#EDF5EE");
    sh.setFrozenRows(1);
  }
  return sh;
}

// 同じ記録IDが既に登録済みかチェック(再送時の二重登録を防ぐ)
function alreadyExists_(sh, recordId) {
  if (sh.getLastRow() < 2) return false;
  const ids = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().flat();
  return ids.some((v) => String(v) === String(recordId));
}

// ── 記録の受信(アプリからのPOST) ──
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 同時送信時の競合を防ぐ
  try {
    const data = JSON.parse(e.postData.contents);
    const rec = data.record;
    if (!rec || !rec.id || !Array.isArray(rec.chems)) {
      return json_({ ok: false, error: "invalid payload" });
    }

    const sh = getSheet_();

    // 二重登録防止(既に受信済みなら成功として返す)
    if (alreadyExists_(sh, rec.id)) {
      return json_({ ok: true, duplicated: true });
    }

    const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
    const rows = rec.chems.map((c) => [
      now,
      String(rec.id),
      rec.date || "",
      data.recorder || "",
      rec.field || "",
      Number(rec.totalL) || 0,
      Math.round((Number(rec.waterMl) || 0)) / 1000, // mL→L
      c.name || "",
      c.formName || "",
      c.ratio || "",
      Math.round(Number(c.ml) || 0),
    ]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);

    return json_({ ok: true, added: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ── 接続テスト(アプリの「接続テスト」ボタンからのGET) ──
function doGet() {
  return json_({ ok: true, app: "薬液調合ノート 受信口", sheet: SHEET_NAME });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
