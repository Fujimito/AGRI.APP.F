// Code.gs を Node 上で動かすための張りぼて。
//
// Google Apps Script でしか動かないコードを、テスト(tools/gastest.cjs)と
// ローカル確認用サーバー(tools/fakegas.cjs)の両方から呼べるようにする。
// Code.gs 本体には手を入れない。検証したいのは「シートに何を書いたか」
// 「何を返したか」であって、Googleの実装そのものではないため張りぼてで足りる。
//
// 配布物ではない(GitHub Pages には置かれない)。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "Code.gs");

// ─────────── スプレッドシートの張りぼて ───────────
// 実物と同じく「2次元配列 + 1始まりの行列番号」で持つ。
// Googleスプレッドシートは "2026-08-26" のような日付に見える文字列を、
// セルに入れた時点で Date として解釈する。読み戻すと文字列ではなく Date が返る。
// これを再現しないと、日付がずれる不具合をテストで捕まえられない。
// 日付だけでなく ISO の日時("2026-08-26T01:02:03.456Z")も同じく Date になる。
// 更新日時の列はここに当たる。ISO で書いたつもりが読み戻すと Date で返り、
// String() すると "Wed Aug 26 2026 ..." になって辞書順の比較が壊れる。
// 列を "@"(文字列)書式に固定してあれば、実物は解釈せず文字列のまま返す。
// この2つを模していなかったので、since の比較が壊れる不具合を捕まえられなかった。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
// 先頭のアポストロフィ。実物は「以降を必ず文字列として扱う」印として食い、
// getValue では返さない(safeCell_ のコメントにあるとおり)。
// つまり '=SUM(1) と書いたセルを読むと "=SUM(1)" が返り、それをそのまま
// 書き戻すと今度は生きた数式になる。これを模していないと、
// 「読んで書き戻す」処理が防御を外す不具合をテストで捕まえられない。
// 文字列として固定されているかどうかは _isFormulaAt で見る。
class Locked {
  constructor(text) { this.text = text; }
}
function coerceIn(v, isText) {
  if (typeof v === "string" && v.charAt(0) === "'") return new Locked(v.slice(1));
  if (isText) return v;
  if (typeof v !== "string") return v;
  if (DATE_RE.test(v)) return new Date(v + "T00:00:00+09:00");
  if (ISO_RE.test(v)) return new Date(v);
  return v;
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];      // rows[r][c] (0始まり)
    this.frozen = 0;
    // 実物のシートは既定1000行で、その外を getRange で掴むと例外になる。
    // 張りぼてが黙って伸びていたので、行数上限に当たる不具合を
    // テストで捕まえられなかった(実データは999行で上限に張り付いていた)。
    this.maxRows = 1000;
    // 列番号(1始まり) → 表示形式。"@" は文字列固定。
    this.formats = {};
  }
  _isText(col0) { return this.formats[col0 + 1] === "@"; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, count) {
    this.maxRows += count;
    return this;
  }
  getLastRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      const row = this.rows[r] || [];
      if (row.some(v => v !== "" && v !== undefined && v !== null)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let n = 0;
    this.rows.forEach(row => { if (row && row.length > n) n = row.length; });
    return n;
  }
  _cell(r, c) {
    if (!this.rows[r]) this.rows[r] = [];
    const v = this.rows[r][c];
    if (v instanceof Locked) return v.text;   // アポストロフィは返らない
    return v === undefined ? "" : v;
  }
  // そのセルが「生きた数式」になっているか(1始まりの行・列)。
  // 文字列として固定されていれば false。テストから使う
  _isFormulaAt(row, col) {
    const v = (this.rows[row - 1] || [])[col - 1];
    return typeof v === "string" && v.charAt(0) === "=";
  }
  getRange(row, col, numRows, numCols) {
    const sh = this;
    const r0 = row - 1, c0 = col - 1;
    const nr = numRows === undefined ? 1 : numRows;
    const nc = numCols === undefined ? 1 : numCols;
    // 実物と同じく、シートの外は掴めない
    if (row + nr - 1 > this.maxRows) {
      throw new Error("Those rows are out of bounds. (行 " + (row + nr - 1) +
        " / シートは " + this.maxRows + " 行)");
    }
    const range = {
      getValues() {
        // 読み取ったセル数を数える(検査で「全行読み」を見張るため)。
        // 実物の GAS には無いが、引いても害はない
        sh._readCells = (sh._readCells || 0) + nr * nc;
        const out = [];
        for (let i = 0; i < nr; i++) {
          const line = [];
          for (let j = 0; j < nc; j++) line.push(sh._cell(r0 + i, c0 + j));
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        // 書いたセル数も数える(「下見なのに書いていないか」を見張るため)
        sh._writeCells = (sh._writeCells || 0) + nr * nc;
        for (let i = 0; i < nr; i++) {
          if (!sh.rows[r0 + i]) sh.rows[r0 + i] = [];
          for (let j = 0; j < nc; j++) sh.rows[r0 + i][c0 + j] = coerceIn(vals[i][j], sh._isText(c0 + j));
        }
        return range;
      },
      getValue() { return sh._cell(r0, c0); },
      setValue(v) {
        sh._writeCells = (sh._writeCells || 0) + 1;
        if (!sh.rows[r0]) sh.rows[r0] = [];
        sh.rows[r0][c0] = coerceIn(v, sh._isText(c0));
        return range;
      },
      setFontWeight() { return range; },
      setNumberFormat(f) {
        for (let j = 0; j < nc; j++) sh.formats[c0 + j + 1] = f;
        return range;
      },
      setNumberFormats(fs) {
        for (let j = 0; j < nc; j++) sh.formats[c0 + j + 1] = fs[0] && fs[0][j];
        return range;
      },
      setBackground() { return range; },
      // 渡された値をそのまま覚えておく(検査から中身を見られるようにするため)。
      // 実物の Sheets が背景色として文字列以外(関数など)を渡されたときに
      // 例外を投げるかどうかは、この張りぼてでは再現していない(未確認)
      setBackgrounds(bg) { sh._lastBackgrounds = bg; return range; },
      clearContent() {
        for (let i = 0; i < nr; i++) {
          if (!sh.rows[r0 + i]) continue;
          for (let j = 0; j < nc; j++) sh.rows[r0 + i][c0 + j] = "";
        }
        return range;
      },
    };
    return range;
  }
  appendRow(values) {
    const at = this.getLastRow();
    if (at + 1 > this.maxRows) this.insertRowsAfter(this.maxRows, 1);
    this.rows[at] = values.map((v, j) => coerceIn(v, this._isText(j)));
  }
  setFrozenRows(n) { this.frozen = n; }
  deleteRows(start, count) {
    // 実物は行ごと消すので、シートの行数そのものが減る
    this.rows.splice(start - 1, count);
    this.maxRows = Math.max(1, this.maxRows - count);
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
}

function makeContext(props) {
  const ss = new FakeSpreadsheet();
  const scriptProps = Object.assign({}, props);
  const ctx = {
    console,
    // vm は独自の Date を持つ。張りぼてが作った Date(こちらの realm)を
    // Code.gs 側で `v instanceof Date` と判定すると、別の realm のコンストラクタ
    // なので false になる。ymd_ / atIso_ / 掃除の Date 分岐が、張りぼての上では
    // 一度も通っていなかった(フォールバックの文字列パースが拾っていたため
    // テストは通り、分岐が死んでいることに気づけなかった)。
    // こちらの Date を渡して realm を揃える。
    Date,
    SHEET_STATE: ss,          // テスト側から中身を覗くための参照
    LOCK_FREE: true,          // false にするとロックが取れない状況を再現する
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in scriptProps ? scriptProps[k] : null),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => ctx.LOCK_FREE,
        releaseLock: () => {},
      }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        // 使っているのは "yyyy-MM-dd" と "yyyy-MM-dd HH:mm:ss" の2つだけ。
        // タイムゾーンは Asia/Tokyo 固定で呼ばれる前提で +09:00 として整える。
        const t = new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString();
        return fmt === "yyyy-MM-dd" ? t.slice(0, 10) : t.slice(0, 19).replace("T", " ");
      },
    },
    DriveApp: {
      getFileById() { throw new Error("no drive in test"); },
      getFilesByName: () => ({ hasNext: () => false }),
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx, { filename: "Code.gs" });
  // トップレベルの const はコンテキストのプロパティにならないので、
  // テストから参照したい定数は式として取り出す
  ctx.read = expr => vm.runInContext(expr, ctx);
  return ctx;
}

// doPost を呼んで、返ってきたJSONをオブジェクトで受け取る
function post(ctx, body) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}


// doPost を呼んで、返ってきたJSONをオブジェクトで受け取る
function post(ctx, body) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}

module.exports = { makeContext, post, FakeSheet, FakeSpreadsheet };
