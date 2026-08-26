# 同梱しているソフトウェアのライセンス

このアプリは、CDNを使わず完全オフラインで動かすために、外部のライブラリを
リポジトリに直接同梱しています。同梱している以上、各ライブラリの著作権表示と
ライセンス全文を配布物に含める義務があります。その全文をこのファイルに収録します。

削除・改変しないでください。ファイルを追加・差し替えたときは、この一覧も更新してください。

| 同梱ファイル | ソフトウェア | バージョン | ライセンス |
|---|---|---|---|
| `react.production.min.js` | React | 18.2.0 | MIT |
| `react-dom.production.min.js` | React DOM | 18.2.0 | MIT |
| `react-dom.production.min.js` に同梱 | Modernizr (Custom Build) | 3.0.0pre | MIT |
| `leaflet.js` / `leaflet.css` / `images/` 配下 | Leaflet | 1.9.4 | BSD 2-Clause |

---

## React / React DOM 18.2.0

対象ファイル: `react.production.min.js`, `react-dom.production.min.js`

配布元: https://react.dev/ (https://github.com/facebook/react)

著作権表示は同梱ファイル先頭の `@license` ヘッダに入っており、
`Copyright (c) Facebook, Inc. and its affiliates.` と記載されています
(現在の権利者名義は Meta Platforms, Inc. and affiliates)。

### MIT License

```
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Modernizr 3.0.0pre (Custom Build)

対象ファイル: `react-dom.production.min.js` の内部
(React DOM のビルドに取り込まれており、単体のファイルとしては存在しません)。
同ファイル中に `Modernizr 3.0.0pre (Custom Build) | MIT` というヘッダが残っています。

配布元: https://modernizr.com/ (https://github.com/Modernizr/Modernizr)

### MIT License

```
The MIT License (MIT)

Copyright (c) The Modernizr Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Leaflet 1.9.4

対象ファイル(すべて Leaflet 由来。このライセンスが適用されます):

- `leaflet.js`
- `leaflet.css`
- `images/marker-icon.png`
- `images/marker-icon-2x.png`
- `images/marker-shadow.png`
- `images/layers.png`
- `images/layers-2x.png`

配布元: https://leafletjs.com/ (https://github.com/Leaflet/Leaflet)

著作権表示: `(c) 2010-2023 Vladimir Agafonkin, (c) 2010-2011 CloudMade`
(`leaflet.js` と `leaflet.css` の先頭 `@preserve` ヘッダに入れてあります)

### BSD 2-Clause License

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 地図タイル・地図データについて(ライセンスではなく利用条件)

地図の画像そのものはこのリポジトリに含まれておらず、表示のたびに配信元から
取得しています。ソフトウェアのライセンスとは別に、各配信元の利用規約に従い、
画面上に出典を表示する必要があります。

- 国土地理院タイル(https://cyberjapandata.gsi.go.jp/) — 出典の明示が必要
- Google Maps(利用者が自分のAPIキーを入れた場合のみ) — Google のサービス利用規約に従う

## 検討して見送ったもの

同じ調査を次に触る人が繰り返さずに済むよう、取り込みを検討して見送ったものを残します。

### leaflet-rotate(地図の回転) — 判定: 不可(2026-08-26)

地図タブに回転・向きの変更を入れられないか検討したもの。Leaflet 本体に回転機能が
ないため、対応するにはこのプラグインの同梱が必要になる。

| 確認項目 | 内容 |
|---|---|
| 権利者・出所 | Raruto ／ https://github.com/Raruto/leaflet-rotate |
| 許諾 | **GPL-3.0**。改変・再配布は可だが、**同じ GPL-3.0 で配布すること**が条件 |
| 表示義務 | ライセンス全文の同梱、著作権表示、対応するソースコードの提供 |

**判定: 不可。** 根拠は GPL-3.0 の copyleft 条項。同梱して配布すると、このアプリ全体を
GPL-3.0 で配布する義務が生じる。リポジトリの `LICENSE` は `All rights reserved` であり、
GitHub Pages から全世界へ配布しているため、両立しない。

同梱済みの React(MIT)・Leaflet(BSD-2-Clause)は許諾条件が表示義務にとどまるため
問題にならないが、GPL は組み込んだ側にも伝播する点が異なる。

**2026-08-26、本人の判断により回転機能そのものを見送ることとした**(アプリ全体を
GPL-3.0 にする選択は取らない)。方針を変える場合は、ライセンス変更の影響を
確認してから取り込むこと。

## 農薬登録情報(chemdb.json)について

`chemdb.json` は農林水産消費安全技術センター(FAMIC)が公開する農薬登録情報を
加工して作成したものです。出典表記と再配布条件は、FAMIC の公開ページの記載に
従ってください(本ファイルはソフトウェアライセンスのみを扱います)。
