// ════════════════════════════════════════════════════════
//  薬液調合ノート — 防除記録受信スクリプト v3(Google Apps Script)
//  ★1回の散布 = シート1行(薬剤は1つのセルにまとめて記載)
//
//  【新規設置】
//  1. Googleスプレッドシートを新規作成
//  2. 拡張機能 → Apps Script → このコードを貼り付けて保存
//  3. デプロイ → 新しいデプロイ → ウェブアプリ
//     (実行: 自分 ／ アクセス: 全員)
//  4. ウェブアプリのURL(…/exec)をアプリの設定に貼り付け
//
//  【v2からの更新】
//  1. Apps Script のコードをこの内容に差し替えて保存
//  2. シート下部のタブ「防除記録」を右クリック → 名前を変更
//     (例:「防除記録_旧」)※旧形式のデータを残すため
//  3. デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ
//     (URLは変わらないので、スマホ側の再設定は不要)
//  次の受信時に、新しい1行形式の「防除記録」シートが自動で作られます。
// ════════════════════════════════════════════════════════

const SHEET_NAME = "防除記録";

const HEADERS = [
  "受信日時",     // 1
  "記録ID",       // 2
  "散布日",       // 3
  "記録者",       // 4
  "圃場",         // 5
  "作物",         // 6
  "面積(a)",      // 7
  "薬剤数",       // 8
  "薬剤内容",     // 9  例: 薬剤A(フロアブル・10倍・1000mL) / 薬剤B(乳剤・16倍・625mL)
  "総量(L)",      // 10
  "水量(L)",      // 11
  "実散布量(L)",  // 12
  "状態",         // 13 調合済 / 散布済
  "報告日",       // 14
  "備考",         // 15
];
const COL = {
  ID: 2, AREA: 7, SPRAYED: 12, STATUS: 13, REPORT_DATE: 14, MEMO: 15,
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

// 指定した記録IDの行番号を返す(なければ0)
function findRow_(sh, recordId) {
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, COL.ID, sh.getLastRow() - 1, 1).getValues().flat();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i]) === String(recordId)) return i + 2;
  }
  return 0;
}

// 薬剤リストを1セル用の文字列にまとめる(用途・剤型・倍率・薬量)
function chemsText_(chems) {
  return chems.map(function (c) {
    var parts = [];
    if (c.useName) parts.push(c.useName);
    if (c.formName) parts.push(c.formName);
    parts.push((c.ratio || "?") + "倍");
    parts.push(Math.round(Number(c.ml) || 0) + "mL");
    return (c.name || "(無名)") + "(" + parts.join("・") + ")";
  }).join(" / ");
}

// 1散布ぶんの行データを作る
function buildRow_(data, status) {
  const rec = data.record;
  const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  return [
    now,
    String(rec.id),
    rec.date || "",
    data.recorder || "",
    rec.field || "",
    rec.crop || "",
    Number(rec.reportAreaA || rec.areaA) || "",
    rec.chems.length,
    chemsText_(rec.chems),
    Number(rec.totalL) || 0,
    Math.round(Number(rec.waterMl) || 0) / 1000, // mL→L
    status === "散布済" ? (Number(rec.sprayedL) || "") : "",
    status,
    status === "散布済" ? (rec.reportDate || "") : "",
    (status === "散布済" ? (rec.reportMemo || rec.memo) : rec.memo) || "",
  ];
}

// ── 受信(アプリからのPOST) ──
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type || "record";

    // ── チーム共有:圃場・薬剤・作業リストのまとめ保存/読込 ──
    // スプレッドシートとは別に、スクリプトのプロパティに保存する
    if (type === "cloudSave") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      PropertiesService.getScriptProperties().setProperty("share:" + data.team, data.payload || "");
      return json_({ ok: true, saved: true });
    }
    if (type === "cloudLoad") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      const payload = PropertiesService.getScriptProperties().getProperty("share:" + data.team);
      return json_({ ok: true, payload: payload || null });
    }

    const rec = data.record;
    if (!rec || !rec.id || !Array.isArray(rec.chems)) {
      return json_({ ok: false, error: "invalid payload" });
    }
    const sh = getSheet_();
    const row = findRow_(sh, rec.id);

    if (type === "record") {
      // 調合記録の新規受信(再送による二重登録は防止)
      if (row > 0) return json_({ ok: true, duplicated: true });
      sh.appendRow(buildRow_(data, "調合済"));
      return json_({ ok: true, added: 1 });
    }

    if (type === "report") {
      // 散布完了報告:既存の行を更新
      if (row > 0) {
        sh.getRange(row, COL.SPRAYED).setValue(Number(rec.sprayedL) || "");
        sh.getRange(row, COL.STATUS).setValue("散布済");
        sh.getRange(row, COL.REPORT_DATE).setValue(rec.reportDate || "");
        if (rec.reportAreaA) sh.getRange(row, COL.AREA).setValue(Number(rec.reportAreaA) || "");
        if (rec.reportMemo) sh.getRange(row, COL.MEMO).setValue(rec.reportMemo);
        return json_({ ok: true, updated: 1 });
      }
      // 元の記録が見つからない場合は報告内容ごと新規追加(取りこぼし防止)
      sh.appendRow(buildRow_(data, "散布済"));
      return json_({ ok: true, added: 1 });
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
  return json_({ ok: true, app: "薬液調合ノート 受信口 v8(1散布=1行・チーム共有対応)", sheet: SHEET_NAME });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
