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
const coerce = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(v + "T00:00:00+09:00") : v;

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];      // rows[r][c] (0始まり)
    this.frozen = 0;
    // 実物のシートは既定1000行で、その外を getRange で掴むと例外になる。
    // 張りぼてが黙って伸びていたので、行数上限に当たる不具合を
    // テストで捕まえられなかった(実データは999行で上限に張り付いていた)。
    this.maxRows = 1000;
  }
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
    return v === undefined ? "" : v;
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
        const out = [];
        for (let i = 0; i < nr; i++) {
          const line = [];
          for (let j = 0; j < nc; j++) line.push(sh._cell(r0 + i, c0 + j));
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        for (let i = 0; i < nr; i++) {
          if (!sh.rows[r0 + i]) sh.rows[r0 + i] = [];
          for (let j = 0; j < nc; j++) sh.rows[r0 + i][c0 + j] = coerce(vals[i][j]);
        }
        return range;
      },
      getValue() { return sh._cell(r0, c0); },
      setValue(v) {
        if (!sh.rows[r0]) sh.rows[r0] = [];
        sh.rows[r0][c0] = coerce(v);
        return range;
      },
      setFontWeight() { return range; },
      setNumberFormat() { return range; },
      setNumberFormats() { return range; },
      setBackground() { return range; },
      setBackgrounds() { return range; },
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
    this.rows[at] = values.map(coerce);
  }
  setFrozenRows(n) { this.frozen = n; }
  deleteRows(start, count) { this.rows.splice(start - 1, count); }
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
