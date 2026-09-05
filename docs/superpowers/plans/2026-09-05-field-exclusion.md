# 端末ごとの圃場除外リスト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 圃場一覧から、選んだ圃場・地区ごとの圃場を「この端末の表示から外す」。共有データと他の端末には一切影響しない。

**Architecture:** 除外は**削除ではなく表示フィルタ**。`tankmix:fields` の中身は一切変えず、除外IDの一覧を `tankmix:excluded` に持ち、画面へ渡すときだけ差し引く。保存データを触らないので `pull` / `cloudLoad` / `pushFieldsSync` は無改造で正しく動き、「元に戻す」もIDを外すだけで済む。

**Tech Stack:** React 18(CDN・JSXなし。`React.createElement` を機械整形した形)／localStorage／`tools/selftest.cjs`(Node の `vm` で `app.js` を読み込む自作ハーネス)

**Spec:** このファイルが spec を兼ねる。矛盾はここで解く。

## Global Constraints

- 日本語のコメント。**推測と実測を区別し、未確認は「未確認」と明示する。** コード内コメント・コミットメッセージにも適用する。
- **既存のコード規約に合わせる。** `app.js` は `React.createElement` を機械整形した出力。周囲の書き方(インデント・`/*#__PURE__*/` の位置・style オブジェクトの形)にそのまま合わせる。**JSX を持ち込まない。**
- **TDD。** 検査を先に書き、**実際に走らせて落ちることを確認**し、その出力を報告に貼る。「落ちるはず」は不可。
- 検証コマンド: `node tools/selftest.cjs` と `node tools/gastest.cjs`。**両方が全件成功すること。既存の検査を1件も落とさないこと。**
- `app.js` の `APP_VERSION` と `sw.js` の `CACHE_VERSION` を必ず一致させる(selftest が見ている)。**版数の直書き検査を足さないこと。**
- コミットは1タスク1コミット。メッセージは日本語、1行目に版数。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## Spec(拘束力のある要求)

- **S1. 保存データを変えない。** 除外しても `tankmix:fields` の中身は減らない。墓標(`addTomb`)を書かない。
- **S2. 共有へ送るものは常に生の一覧。** `cloudSave` と `pushFieldsSync` が送る圃場は、除外の影響を受けない。**ここを間違えると、自分の端末の除外が他の全端末とサーバーから圃場を消す。**
- **S3. 元に戻せる。** 除外した圃場は、いつでも全件または個別に戻せる。
- **S4. 過去の作業記録は壊れない。** 除外した圃場を参照する作業の表示が変わらない(作業は `snapshot` を持っている)。
- **S5. 除外は端末ごと。** `tankmix:excluded` は同期の対象にしない。`cloudSave` の payload にも載せない。

## File Structure

| ファイル | 責務 | 変更の種類 |
|---|---|---|
| `app.js` | 除外の純関数(トップレベル)／`App` の state と派生値／`FieldMasterPanel` の選択UI／設定タブの復帰UI | 変更 |
| `sw.js` | `CACHE_VERSION` | 変更(1行) |
| `tools/selftest.cjs` | 純関数の検査＋配線の文字列検査。`EXPORTS` に新しい関数名を足す | 変更 |
| `docs/仕組み_エンジニア向け.html` | 07節に設計の記録 | 変更(Task 3) |

**触ってはいけないもの:** `Code.gs`(GAS側は無改造)、`pull` / `cloudLoad` / `pushFieldsSync` の本体。

---

## Task 1: 除外の土台と、表示への反映

**版数: v9.18**

**Files:**
- Modify: `app.js`(トップレベルに純関数3つ／`App` 内に state と派生値／`WorkTab` と `FieldTab` への受け渡し2箇所)
- Modify: `sw.js`
- Test: `tools/selftest.cjs`

**Interfaces:**
- Produces: `EXCLUDED_KEY`(定数 `"tankmix:excluded"`)、`normalizeExcluded(list)`、`applyExclusion(fields, excluded)`、`toggleExcluded(excluded, ids, on)` — Task 2・3 がこれらを使う
- Produces: `App` 内の `excluded`(文字列の配列)、`setExcluded(next)`、`fieldsShown`(派生した配列)

**なぜこの形か(実装者へ):**

素朴に「`tankmix:fields` から消す」と、圃場は戻ってきます。実測で確認済み:

- `pull` は `if (!old) byId.set(key, itemToField(inc))` で、**手元に無いIDを新規として入れ直す**
- 「共有データを取り込む」(`cloudLoad`)は全件を入れ直すので**その場で全部戻る**

墓標(`addTomb`)を書けば消せますが、それは**他の全端末とサーバーからも消す**ことになり、「この端末だけ」という要求に合いません。なので保存データには触らず、**画面へ渡す直前に差し引きます。**

- [ ] **Step 1: 純関数の検査を書く**

`tools/selftest.cjs` の末尾、`// ─────────── 結果 ───────────` の直前に新しい節として足す。

```js
// ── 端末ごとの圃場除外(v9.18) ────────────────────────
// 除外は「削除」ではなく表示フィルタ。tankmix:fields の中身は変えない。
// 保存データを変えないので、pull も cloudLoad も無改造で正しく動く。
{
  const norm = t.normalizeExcluded, apply = t.applyExclusion, tog = t.toggleExcluded;

  eq("壊れた値は空配列にする", [norm(null), norm(undefined), norm("x"), norm(42)],
     [[], [], [], []]);
  eq("数値と文字列のIDを混ぜても同じものとして扱う", norm([1, "1", 2]), ["1", "2"]);
  eq("並びは入れた順のまま", norm([3, 1, 2]), ["3", "1", "2"]);
  eq("空文字とnullは捨てる", norm([1, "", null, undefined, 2]), ["1", "2"]);

  const fs = [{ id: 1, name: "北" }, { id: 2, name: "南" }, { id: 3, name: "東" }];
  eq("除外したものが落ちる", apply(fs, ["2"]).map(f => f.name), ["北", "東"]);
  eq("空の除外なら全部出る", apply(fs, []).map(f => f.name), ["北", "南", "東"]);
  eq("数値IDでも落ちる", apply(fs, [2]).map(f => f.name), ["北", "東"]);
  eq("元の配列を書き換えない", (apply(fs, ["2"]), fs.length), 3);
  eq("fields が無くても落ちない", apply(null, ["1"]), []);

  eq("足す", tog([], [1, 2], true), ["1", "2"]);
  eq("重ねて足しても増えない", tog(["1"], [1, 2], true), ["1", "2"]);
  eq("外す", tog(["1", "2", "3"], [2], false), ["1", "3"]);
  eq("無いものを外しても壊れない", tog(["1"], [9], false), ["1"]);
  eq("全部外す", tog(["1", "2"], ["1", "2"], false), []);
}
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node tools/selftest.cjs`

Expected: `normalizeExcluded is not defined` 相当の ReferenceError(`EXPORTS` に無いため、テストが1件も走らずに落ちる)。

**この出力を報告に貼ること。**

- [ ] **Step 3: 純関数を実装する**

`app.js` のトップレベル、`const load = (key, fallback) => {` の近く(他の `tankmix:` 定数が並んでいるあたり)に置く。

```js
// ── この端末の表示から外した圃場(v9.18) ──
// 「削除」ではなく表示フィルタ。tankmix:fields の中身は減らさない。
//
// なぜ消さないか:
//   保存データから消しても圃場は戻ってくる。pull は手元に無いIDを
//   新規として入れ直し、cloudLoad は全件を入れ直す(どちらも実測で確認)。
//   墓標を書けば消せるが、それは他の全端末とサーバーからも消すことになり、
//   「この端末だけ」という要求に合わない。
//
// IDは数値で入っている場所と文字列で入っている場所があるので、
// 鍵は必ず String に寄せてから比べる。
const EXCLUDED_KEY = "tankmix:excluded";
const normalizeExcluded = list => {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(v => {
    if (v === null || v === undefined || v === "") return;
    const k = String(v);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  });
  return out;
};
const applyExclusion = (fields, excluded) => {
  const set = new Set(normalizeExcluded(excluded));
  if (!set.size) return Array.isArray(fields) ? fields.slice() : [];
  return (fields || []).filter(f => !set.has(String(f.id)));
};
const toggleExcluded = (excluded, ids, on) => {
  const cur = normalizeExcluded(excluded);
  const keys = normalizeExcluded(ids);
  if (!on) {
    const drop = new Set(keys);
    return cur.filter(k => !drop.has(k));
  }
  return normalizeExcluded(cur.concat(keys));
};
```

- [ ] **Step 4: `EXPORTS` に足す**

`tools/selftest.cjs` の `EXPORTS` 配列(25行目付近)に `"EXCLUDED_KEY"`, `"normalizeExcluded"`, `"applyExclusion"`, `"toggleExcluded"` を足す。

**足さないと `ReferenceError` でテストが1件も走らない。**

- [ ] **Step 5: 検査が通ることを確認する**

Run: `node tools/selftest.cjs`

Expected: 全件成功。

- [ ] **Step 6: `App` に state と派生値を足す**

`const [fields, setFields] = useState(() => load("tankmix:fields", []));` の近くに足す。

```js
  // この端末の表示から外した圃場ID。同期しない(S5)。
  // fields の中身は減らさないので、共有へ送るものは影響を受けない(S2)。
  const [excluded, setExcludedState] = useState(() => normalizeExcluded(load(EXCLUDED_KEY, [])));
  const setExcluded = next => {
    const v = normalizeExcluded(next);
    setExcludedState(v);
    save(EXCLUDED_KEY, v);
  };
```

`fields` の宣言より**後ろ**に、派生値を置く。

```js
  // 画面へ渡すのはこちら。fields(生)は共有へ送る側が使う。
  const fieldsShown = React.useMemo(() => applyExclusion(fields, excluded), [fields, excluded]);
```

- [ ] **Step 7: 画面へ渡す2箇所だけ差し替える**

`App` から下へ渡している2箇所を `fields` → `fieldsShown` にする。短縮記法をやめて `fields: fieldsShown,` と書く。

1. `WorkTab` の props(`tab === "work" && React.createElement(WorkTab, { works, fields, workDate, ...`)
2. `FieldTab` の props(`key: gmapId || "raster", fields, addFieldWithPolygon, ...`)

**`cloudSave` の payload(`fields: fields.map(compactField)`)は絶対に変えない。** ここを変えると自分の除外が共有データから圃場を消す(S2)。

`pushFieldsSync` は `load("tankmix:fields", [])` を直接読んでいるので無改造で正しい(実測で確認済み)。

- [ ] **Step 8: 配線の検査を足す**

Step 1 で作った節に足す。

```js
  // ★S2: 共有へ送るものは生の一覧のまま。ここが fieldsShown になると、
  // この端末の除外が他の全端末とサーバーから圃場を消す。
  eq("cloudSave は生の fields を送る",
     src.includes("fields: fields.map(compactField)"), true);
  eq("cloudSave は除外後の一覧を送らない",
     src.includes("fields: fieldsShown.map(compactField)"), false);
  // pushFieldsSync は保存済みの一覧を直接読む
  eq("送信は保存データを直接読む",
     src.includes('const cur = load("tankmix:fields", []);'), true);
  // 画面へ渡すのは除外後
  eq("画面へ渡すのは除外後の一覧",
     (src.match(/fields: fieldsShown,/g) || []).length, 2);
  eq("除外リストの鍵", src.includes('"tankmix:excluded"'), true);
  // ★S4: 作業行の圃場名は resolveWork が引く。ここは App の中にあり
  // 生の fields を見ているので、除外しても過去の記録の表示は変わらない
  eq("作業行の圃場名は生の一覧から引く",
     src.includes("const f = fields.find(x => x.id === w.fieldId);"), true);
```

**S4 について(実測で確認済み・実装者は壊さないこと):**

`resolveWork` は `App` の中にあり、**生の `fields`** を引いています。

```js
const resolveWork = w => {
  const f = fields.find(x => x.id === w.fieldId);
  return f || w.snapshot || { name: "(不明)", crop: "", areaA: "" };
};
```

`fields` を生のまま残す設計なので、**除外しても作業行の圃場名・面積はそのまま出ます。** ここを `fieldsShown` に変えると、除外した圃場の過去の記録が snapshot 頼みになり、名前の変更が反映されなくなります。**変えないこと。**

なお `startEditField`(作業行から圃場を編集する導線)は `p.fields`(＝除外後)を引き、`if (!master) return;` で既に守られています。除外した圃場はそこから編集できなくなりますが、**黙って何も起きない**ので、気になるようなら Task 3 のあとに別途扱います(今回の範囲外)。

- [ ] **Step 9: 版数を上げて両スイートを通す**

`app.js` の `APP_VERSION` を `"v9.18"`、`sw.js` の `CACHE_VERSION` を `"tankmix-v9.18"` に。

Run: `node tools/selftest.cjs` と `node tools/gastest.cjs`

Expected: 両方とも全件成功。

- [ ] **Step 10: 構文を確認する**

Run: `node -e "new (require('vm').Script)(require('fs').readFileSync('app.js','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 11: コミット**

1行目を `圃場をこの端末の表示から外せるようにした(土台・v9.18)` として、本文に次を書く。

- 削除ではなく表示フィルタにしたこと、`tankmix:fields` の中身は変えないこと
- 保存データから消す作りにすると圃場が戻ること(`pull` は手元に無いIDを新規として入れ直す／`cloudLoad` は全件入れ直す。**実測**)
- 墓標を書けば消せるが他の全端末とサーバーからも消えるので要求に合わないこと
- `cloudSave` が送るのは生の `fields` のままであること、取り違えると共有から圃場が消えること
- UIはまだ無いこと(Task 2)
- 足した検査の件数と、出す前の状態で落ちることを確認済みであること

---

## Task 2: 一覧の選択と、まとめて外す

**版数: v9.19**

**Files:**
- Modify: `app.js`(`function FieldMasterPanel(p)` の本体)
- Modify: `app.js`(`FieldTab` の**2実装**が `FieldMasterPanel` へ渡す props)
- Modify: `app.js`(`App` が `FieldTab` へ渡す props)
- Modify: `sw.js`
- Test: `tools/selftest.cjs`

**Interfaces:**
- Consumes: Task 1 の `toggleExcluded`、`App` の `excluded` / `setExcluded`
- Produces: `FieldMasterPanel` の props `excluded`(配列)と `setExcluded`(関数)

**実装者への注意:**

`FieldTab` は **Leaflet 版と Google 版の2つ**あります。`listOnly && React.createElement(FieldMasterPanel, {` で grep すると2箇所出ます。**片方だけ直すとGoogle地図を使っている端末で動きません。** このリポジトリでは同じ取りこぼしが v9.10・v9.11 で実際に起きています。両方に同じ props を足すこと。

- [ ] **Step 1: 検査を先に書く**

Task 1 の節に足す。

```js
  // 一覧の選択と一括除外(v9.19)
  // FieldTab は Leaflet 版と Google 版の2つある。片方だけ直す事故が
  // v9.10・v9.11 で実際に起きているので、2箇所あることを数える
  eq("2つの地図タブの両方から excluded を渡している",
     (src.match(/excluded: p\.excluded,/g) || []).length, 2);
  eq("2つの地図タブの両方から setExcluded を渡している",
     (src.match(/setExcluded: p\.setExcluded,/g) || []).length, 2);
  eq("選択の状態を持っている", src.includes("const [sel, setSel] = useState"), true);
  eq("外すのは toggleExcluded を通す", src.includes("toggleExcluded(p.excluded"), true);
  // 文言。「削除」と書くと共有からも消えると誤解される
  eq("文言は「削除」ではなく「外す」", src.includes("この端末の一覧から外す"), true);
  eq("地区ごとに外せる", src.includes("この地区を端末から外す"), true);
  eq("確認文で共有に影響しないと伝える",
     src.includes("共有データと他の端末は変わりません"), true);
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node tools/selftest.cjs`

Expected: 上の7件が失敗する。**出力を報告に貼ること。**

- [ ] **Step 3: props を通す**

`App` の `FieldTab` props に `excluded,` と `setExcluded,` を足す。
`FieldTab` の**両方の実装**で、`FieldMasterPanel` へ `excluded: p.excluded,` と `setExcluded: p.setExcluded,` を渡す。

- [ ] **Step 4: `FieldMasterPanel` に選択の仕組みを足す**

`const [fq, setFq] = useState("")` の近くに置く。

```js
  // 選択中の圃場ID(文字列)。一覧を離れたら消えてよいので保存しない
  const [sel, setSel] = useState(() => new Set());
  const selHas = id => sel.has(String(id));
  const selToggle = id => setSel(s => {
    const n = new Set(s);
    const k = String(id);
    if (n.has(k)) n.delete(k);else n.add(k);
    return n;
  });
  // 「外す」は削除ではない。共有データも他の端末も変わらない
  const excludeIds = ids => {
    const list = (ids || []).map(String);
    if (!list.length) return;
    p.setExcluded(toggleExcluded(p.excluded, list, true));
    setSel(new Set());
  };
```

- [ ] **Step 5: 各行にチェックボックスを足す**

`isOpen(g.name) && g.items.map(f => ...)` の中、`S.listItem` の直下、`f.name` を出している `div` より**前**に置く。`p.setExcluded` が渡っているときだけ出す。

```js
p.setExcluded && /*#__PURE__*/React.createElement("input", {
  type: "checkbox",
  checked: selHas(f.id),
  onChange: () => selToggle(f.id),
  style: {
    width: 20,
    height: 20,
    marginRight: 8,
    flexShrink: 0
  },
  title: "選んでまとめて外す"
}),
```

- [ ] **Step 6: 選択中だけ出る操作バーを足す**

検索欄の下、`fieldGroups.map(...)` の前に置く。

```js
p.setExcluded && sel.size > 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginBottom: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  className: "num"
}, sel.size, "件を選択中"), /*#__PURE__*/React.createElement("button", {
  onClick: () => setSel(new Set()),
  style: S.smallSecondary
}, "選択を解除"), /*#__PURE__*/React.createElement("button", {
  onClick: () => {
    if (confirm(sel.size + "件をこの端末の一覧から外しますか？\n\n共有データと他の端末は変わりません。\n設定タブからいつでも戻せます。")) excludeIds(Array.from(sel));
  },
  style: {
    ...S.smallDanger,
    marginLeft: "auto"
  }
}, "この端末の一覧から外す")),
```

- [ ] **Step 7: 地区ごとに外すボタンを足す**

地区見出しの `🔢 連番` と `👁` が並んでいるところに足す。

```js
p.setExcluded && /*#__PURE__*/React.createElement("button", {
  onClick: e => {
    e.stopPropagation();
    if (confirm("地区「" + g.name + "」の" + g.items.length + "件を、この端末の一覧から外しますか？\n\n共有データと他の端末は変わりません。\n設定タブからいつでも戻せます。")) excludeIds(g.items.map(f => f.id));
  },
  style: {
    ...S.smallSecondary,
    padding: "4px 8px"
  },
  title: "この地区を端末から外す"
}, "🚫"),
```

- [ ] **Step 8: 検査が通ることを確認する**

Run: `node tools/selftest.cjs` と `node tools/gastest.cjs`

Expected: 両方とも全件成功。

- [ ] **Step 9: 構文を確認する**

Run: `node -e "new (require('vm').Script)(require('fs').readFileSync('app.js','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 10: 版数を上げてコミット**

`APP_VERSION` を `"v9.19"`、`CACHE_VERSION` を `"tankmix-v9.19"`。

1行目を `圃場一覧で選んでまとめて外せるようにした(v9.19)` として、本文に次を書く。

- 行のチェックボックスで選び、まとめて外せること。地区見出しの 🚫 でその地区をまとめて外せること
- 文言を「削除」にしなかった理由(共有からも消えると誤解される)
- `FieldTab` が2実装あるので両方に props を足したこと。片方だけだとGoogle地図の端末で動かないこと(v9.10・v9.11 で実際に起きた形)
- 足した検査の件数と、出す前の状態で落ちることを確認済みであること

---

## Task 3: 元に戻すUIと、記録

**版数: v9.20**

**Files:**
- Modify: `app.js`(設定タブ。共有設定のカードの近く)
- Modify: `app.js`(`App` が設定タブへ渡す props)
- Modify: `sw.js`
- Modify: `docs/仕組み_エンジニア向け.html`
- Test: `tools/selftest.cjs`

**Interfaces:**
- Consumes: Task 1 の `toggleExcluded`、`App` の `excluded` / `setExcluded` / `fields`(生)

**なぜ必要か:** 戻せない除外は事故ったときに詰みます(S3)。外した本人が数日後に「1件だけ戻したい」と言えるようにする。

- [ ] **Step 1: 検査を先に書く**

```js
  // 元に戻す(v9.20)
  eq("設定タブに外した件数を出す", src.includes("この端末で外した圃場"), true);
  eq("全部戻せる", src.includes("すべて一覧に戻す"), true);
  eq("1件ずつ戻せる", src.includes("toggleExcluded(p.excluded, [id], false)"), true);
  // 戻す対象の名前は生の fields から引く。除外後の一覧には無い
  eq("外した圃場の名前は生の一覧から引く", src.includes("fieldsAll: fields,"), true);
  eq("共有から消えたIDも戻せる", src.includes("(共有データにありません)"), true);
```

- [ ] **Step 2: 落ちることを確認する**

Run: `node tools/selftest.cjs`

Expected: 上の5件が失敗する。**出力を報告に貼ること。**

- [ ] **Step 3: `App` から設定タブへ生の一覧を渡す**

設定タブの props に `fieldsAll: fields,` と `excluded,` `setExcluded,` を足す。

**`fieldsShown` ではない** — 外した圃場の名前は除外後の一覧には無いので引けない。

- [ ] **Step 4: 設定タブに復帰UIを足す**

共有設定のカードの下に、`p.excluded && p.excluded.length > 0` のときだけ出すカードを足す。周囲の設定カードの書き方(`S.card` / `S.cardLabel` / `S.hint`)に合わせる。

中身:

- 見出し: `"この端末で外した圃場(" + p.excluded.length + "件)"`
- 説明: `"共有データには残っています。この端末の一覧と地図に出さないだけです。"`
- 「すべて一覧に戻す」ボタン。`confirm` を挟み、押されたら `p.setExcluded([])`
- 外した圃場を1件ずつ並べ、各行に「戻す」ボタン。押されたら `p.setExcluded(toggleExcluded(p.excluded, [id], false))`
- 名前は `p.fieldsAll` から `String(f.id) === id` で引く。**引けないIDは `"(共有データにありません) ID:" + id` と出す**(除外したあと他の端末がその圃場を削除した場合)。**戻すボタンは出す** — 除外リストから外せないと、そのIDが永久に残る

- [ ] **Step 5: 検査が通ることを確認する**

Run: `node tools/selftest.cjs` と `node tools/gastest.cjs`

Expected: 両方とも全件成功。

- [ ] **Step 6: 構文を確認する**

Run: `node -e "new (require('vm').Script)(require('fs').readFileSync('app.js','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 7: `docs/仕組み_エンジニア向け.html` の07節に記録を足す**

書く内容:

- なぜ「削除」ではなく表示フィルタにしたか(保存データから消すと `pull` と `cloudLoad` で戻ってくる。**実測で確認した挙動として書く**)
- なぜ墓標を書かないか(他の全端末とサーバーからも消える)
- S2 の危うさ(`cloudSave` が `fieldsShown` を送ると、自分の除外が共有から圃場を消す)と、それを固定している検査
- **実機で試していないことは「未確認」と書く。** 断定しない

既存の節の書き方(`<div class="fail">` は過去の不具合の記録。**今回は不具合ではないので使わない**)に合わせること。

- [ ] **Step 8: 版数を上げてコミット**

`APP_VERSION` を `"v9.20"`、`CACHE_VERSION` を `"tankmix-v9.20"`。

1行目を `外した圃場を元に戻せるようにした(v9.20)` として、本文に次を書く。

- 設定タブに「この端末で外した圃場(N件)」を出し、全件または1件ずつ戻せること
- 戻せない除外は事故ったときに詰むこと
- 名前は生の `fields` から引くこと。除外後の一覧には無いので引けないこと
- 除外したあと他の端末がその圃場を削除した場合はIDだけ出して戻すボタンは残すこと
- 07節に設計の記録を残したこと
- 足した検査の件数と、出す前の状態で落ちることを確認済みであること
