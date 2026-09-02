# 台帳の二重送信をやめる(record / report / unreport の削除)

## 背景

端末は同じ実績を2回送っている。

1. `pushWorks` → 「作業」シート(共有の土台)
2. `record` / `report` / `unreport` → 「防除記録」シート(人が読む台帳)

v9.09 の照合で、台帳は作業シートから完全に作り直せると実測できた
(一致433 / 食い違い0 / 台帳に無い0)。よって 2 は要らない。

外すと得られるもの:
- 2つのシートが食い違わなくなる(食い違いの発生源が消える)
- 送信回数が減る(170圃場の日で 340回 → 0回)
- `applyRecord_` / `buildRow_` / `findRow_` / `claimRow_` が消える(GAS 約200行)

## Spec(拘束力のある要求)

このファイルが spec を兼ねる。矛盾はここで解く。

- **S1. 台帳の行は、`pushWorks` を受けた時点で書かれること。**
  端末は `record` / `report` を送らなくても台帳が揃う。
- **S2. 台帳の既存行の「受信日時」(列1)を書き換えないこと。**
  台帳は人が読んで印刷する表で、受信日時は「実際に受け取った時刻」を指す。
  `ledgerRebuild_` と同じ約束。
- **S3. 台帳の行を消さないこと。** 削除済みの作業が来ても、台帳の行は残す。
  `ledgerRebuild_` と同じ約束(元帳なので消さない)。
- **S4. `ledgerCheck` が食い違い0のままであること。**
  つまり `pushWorks` が書く台帳の行は、`ledgerRowFromWork_` が作る行と
  1バイトも違わないこと。同じ関数を通すこと。
- **S5. 台帳シートの内容を読んで書き戻さないこと。**
  読むのは記録IDとチームコードの列だけ。書くのは自分で作った値だけ。
  (v9.09 / v9.12 の数式インジェクション再点火を繰り返さない)
- **S6. `upsertRows_` が飛ばした行(古い `updatedAt`)は台帳にも書かないこと。**
  作業シートに入らなかったものを台帳にだけ入れると、S4 が崩れる。

## Global Constraints(全タスク共通)

- **日本語のコメント。** 推測と実測を区別し、未確認は「未確認」と明示する。
  コメント・コミットメッセージにも同じ規律を適用する。
- **新しく書く値も、書き戻す値も `safeCell_` を通す。**
  `getValues()` の戻りを素で `setValues()` に渡さない。
- **テストを先に書き、落ちることを確認してから直す。**
  対照実験(直す前の状態で新しい検査が落ちること)を必ず報告に書く。
- 検証コマンド: `node tools/selftest.cjs` と `node tools/gastest.cjs`。
  両方が全件成功すること。**既存の検査を1件も落とさないこと。**
- `app.js` の `APP_VERSION` と `sw.js` の `CACHE_VERSION` は必ず一致させる
  (selftest が見ている)。
- **既存のコード規約に合わせる。** `Code.gs` は `var` / `function` 宣言と
  `const` が混在している。周りに合わせる。
- コミットは1タスク1コミット。メッセージは日本語、1行目に版数。

## Task 1: pushWorks が台帳も書くようにする

**版数: v9.13**

### やること

`Code.gs` に `ledgerSyncWorks_(rows, team)` を足し、`pushWorks` から呼ぶ。

1. `upsertRows_` の戻りに `applied` を足す。
   実際にシートへ書いた行(`toRow` の戻り値そのもの)を配列で返す。
   飛ばした行(`skipped`)は入れない。追加・更新の両方を入れる。
   他の呼び出し元(`pushFields` / `pushChems`)は使わないので影響しない。

2. `ledgerSyncWorks_(rows, team)` を新しく書く。`rows` は作業シートの行の配列。

   ```
   function ledgerSyncWorks_(rows, team) {
     if (!rows || !rows.length) return { added: 0, updated: 0 };
     const lg = getSheet_();
     const W = HEADERS.length;
     const last = lg.getLastRow();
     // 記録IDとチームコードの列だけ読む。台帳の中身は読まない(S5)
     const ids  = last >= 2 ? lg.getRange(2, COL.ID,   last - 1, 1).getValues() : [];
     const tms  = last >= 2 ? lg.getRange(2, COL.TEAM, last - 1, 1).getValues() : [];
     const rowOf = {};
     for (var i = 0; i < ids.length; i++) {
       var id = ids[i][0];
       if (id === "" || id === null || id === undefined) continue;
       var rt = String(tms[i][0] == null ? "" : tms[i][0]);
       // チーム欄が空の行は古い行。どのチームのものか分からないので拾う
       // (findRow_ の第2段・ledgerRebuild_ と同じ扱い)
       if (team && rt && rt !== String(team)) continue;
       if (!(String(id) in rowOf)) rowOf[String(id)] = i + 2;  // シートの行番号
     }
     var added = 0, updated = 0;
     var append = [];
     for (var k = 0; k < rows.length; k++) {
       var r = rows[k];
       if (r[16]) continue;                 // 削除済みは台帳に足さない(S3)
       var want = ledgerRowFromWork_(r);    // S4: 照合と同じ関数を通す
       var key = String(r[0]);
       if (key in rowOf) {
         // 受信日時(列1)は書き換えない(S2)。列2以降だけ書く
         lg.getRange(rowOf[key], 2, 1, W - 1)
           .setValues([want.slice(1).map(safeCell_)]);
         updated++;
       } else {
         append.push(want.map(safeCell_));
         added++;
       }
     }
     if (append.length) {
       ensureRows_(lg, last + append.length + 1);
       lg.getRange(last + 1, 1, append.length, W).setValues(append);
       colorByDate_(lg);
     }
     return { added: added, updated: updated };
   }
   ```

   ※上のコードはそのまま使ってよい。周りの書き方に合わせてある。
   ※`last` が 1(見出しだけ)のとき `last + 1 = 2` で正しい。

3. `pushWorks` の分岐で呼ぶ。`pushFields` / `pushChems` では呼ばない。

   ```
   const res = upsertRows_(getWorkSheet_(), WORK_HEADERS, WORK_ID_COL, WORK_EDIT_COL,
                           list, workRow_, data.team, null);
   // 台帳(防除記録)も同じ受信で揃える(提案D・v9.13)。
   // これがあるので端末は record / report を別に送らなくてよい。
   const lg = ledgerSyncWorks_(res.applied, data.team);
   res.ledgerAdded = lg.added;
   res.ledgerUpdated = lg.updated;
   delete res.applied;   // 応答に行の中身を載せない(要らないうえに重い)
   return json_(res);
   ```

4. `features` に `"ledgerFromWorks"` を足す。
   端末側が「この GAS は pushWorks で台帳を書く」と判定できるようにする。

### 受け入れ条件(先にテストを書く。`tools/gastest.cjs` に §24 として足す)

1. `pushWorks` だけで台帳に行ができる(`record` を1度も送らない)。
2. そのあと `ledgerCheck` の `differ` が 0、`onlyWork` が 0。
3. 同じ作業をもう一度 `pushWorks` すると、台帳の行が**増えない**(更新になる)。
4. 更新のとき、台帳の**受信日時(列1)が変わらない**(S2)。
5. `deleted: true` の作業を送っても、台帳の行が**消えない**(S3)。
6. `updatedAt` が古くて `upsertRows_` に飛ばされた作業は、台帳にも入らない(S6)。
7. 台帳の触らない行に `=IMPORTXML(...)` を仕込み、別の作業を `pushWorks`
   しても数式にならない(S5)。
8. 実績あり(`status: "done"`)の作業で、台帳の状態が「散布済」・実散布量・
   報告日・実績メモが入る。

### やらないこと

- `record` / `report` / `unreport` はまだ消さない(Task 3)。
- 端末側(`app.js`)はまだ触らない(Task 2)。
- 台帳シートの中身を読まない。

## Task 2: 端末が台帳へ別送するのをやめる

**版数: v9.14**

### やること

`app.js` から台帳への別送を外す。

1. `syncPending` を消す。呼び出し元(送信ボタン・再開ボタン)も含めて外す。
   `buildLedgerOps` / `buildPayload` / `abortSync` / `syncProgress` /
   `isPending` の扱いを整理する。
   **`w.synced` / `w.reported` / `w.reportSynced` / `w.unreportPending` の
   意味づけを変えないこと。** これらは画面表示(未送信の印)に使われている。

   ※どこまで消せるかは実装者が読んで判断してよい。ただし
   「送信ボタンを押したら台帳へ送る」動作が無くなること、
   「未送信の印」の表示が壊れないことの2つは必須。

2. 進捗の送信(`pushProgress`)は残す。これが台帳を書く唯一の経路になる。

3. 送信ボタンの文言・案内を、実態に合わせて直す。
   「台帳へ送信」ではなく「進捗を送信」。

### 受け入れ条件(`tools/selftest.cjs`)

1. `buildLedgerOps` が `app.js` から消えている(検査も外す)。
2. `type: "record"` / `"report"` / `"unreport"` / `"pushRecords"` を
   送る箇所が `app.js` に1つも無い。
3. 未送信の印(`isPending` 相当)の判定が残っていること。
4. 既存の検査を1件も落とさない。落ちる検査は、
   **消した機能を見ているものだけ**を外してよい。外したものは報告に列挙する。

### やらないこと

- GAS 側はまだ触らない(Task 3)。
- 同期の他の経路(`pushFields` / `pushChems` / `pull`)を触らない。

## Task 3: GAS から record / report / unreport を消す

**版数: v9.15**

### やること

`Code.gs` から次を消す。

- `doPost` の `record` / `report` / `unreport` の分岐
- `pushRecords` の分岐
- `applyRecord_` / `buildRow_` / `findRow_` / `claimRow_` / `chemsText_`
  ※`chemsText_` は他から使われていないか確認してから消す。
   使われていれば残す。

`features` から `"pushRecords"` を外す。

### 受け入れ条件(`tools/gastest.cjs`)

1. `type: "record"` を送ると `unknown type` が返る。
   `report` / `unreport` / `pushRecords` も同じ。
2. 消した関数の名前が `Code.gs` に1つも残っていない。
3. `pushWorks` → `ledgerCheck` が `differ: 0` のままであること。
4. 消した機能を見ていた既存の検査は外してよい。外したものは報告に列挙する。
   **それ以外の検査は1件も落とさない。**

### やらないこと

- `ledgerCheck` / `ledgerRebuild` は残す(照合と作り直しは引き続き要る)。
- `safeCell_` は残す(全体で使っている)。

## 展開の順序(コードの外の話)

コードは3タスクぶん書くが、**本番への反映は分けること。**

1. Task 1 の `Code.gs` を貼る → 端末で「台帳の照合」を押す →
   **食い違い0・台帳に無い0 を確認する**
2. 確認できてから Task 2・Task 3 を反映する

順番を逆にすると、Task 1 に欠陥があったときに実績が台帳に残らない。
