#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
chemdb.json 更新スクリプト

FAMIC(農林水産消費安全技術センター)が公開する「農薬登録情報ダウンロード」の
基本部CSVを取得し、アプリ用の軽量JSON(chemdb.json)を再生成する。

  出典: https://www.acis.famic.go.jp/ddata/index2.htm
  更新: 原則として月初。月1回程度このスクリプトを実行して差し替える運用を想定。

  ⚠ 出力した chemdb.json はリポジトリにコミットしないこと。
    FAMICの利用規約 (https://www.famic.go.jp/docs/rule/) は
    「無断で改変を行うことはできない」「許可なく商業目的での利用を禁止」と
    している。このスクリプトが作る chemdb.json は列を抜き出して変換した
    加工物なので、公開リポジトリに同梱して配布する形は取らない。
    そのため chemdb.json は .gitignore に入れてある。

  ★このファイルの用途は「Googleドライブにアップロードするためのファイルを作ること」。
    生成 → 自分のGoogleドライブにアップロード → ファイルIDを Apps Script の
    スクリプトプロパティ CHEMDB_FILE_ID に設定 → アプリの設定タブ「農薬データ」から
    各端末に取り込む、という流れになる(README「農薬データの取り込み」を参照)。
    手元で生成して自分たちで使うぶんと、公開配布は別の話である点に注意。

使い方(リポジトリ直下で):
    python tools/update_chemdb.py

出力先はリポジトリ直下の chemdb.json だが、これは置き場所として都合がよいだけで、
配布物ではない。コミットせず、Googleドライブへのアップロード用として扱うこと。

依存: 標準ライブラリのみ(Python 3.8+)。
"""
import csv
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
import zipfile

INDEX_URL = "https://www.acis.famic.go.jp/ddata/index2.htm"
BASE_URL = "https://www.acis.famic.go.jp/ddata/"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "chemdb.json")

# 用途(CSVの表記) -> アプリのUSESキー
USE_MAP = {
    "殺菌剤": "fungicide",
    "殺虫剤": "insecticide",
    "殺虫殺菌剤": "fung_insect",
    "除草剤": "herbicide",
    "植物成長調整剤": "growth",
    "展着剤": "spreader",
}


def form_key(s):
    """剤型名(CSV表記) -> アプリのFORMSキー。固形/液状の判定にも使われる。"""
    if re.search(r"顆粒水和|ドライフロアブル|ＤＦ|DF", s):
        return "wg"
    if "水和" in s:
        return "wp"
    if re.search(r"フロアブル|ゾル", s):
        return "sc"
    if "顆粒水溶" in s:
        return "sg"
    if "水溶" in s:
        return "sp"
    if "乳剤" in s:
        return "ec"
    if "マイクロエマルション" in s:
        return "me"
    if re.search(r"エマルション|ＥＷ|EW", s):
        return "ew"
    if "液剤" in s:
        return "sl"
    if "油剤" in s:
        return "oil"
    if "粒剤" in s:
        return "gr"
    if re.search(r"粉剤|ＤＬ|DL", s):
        return "dl"
    if re.search(r"ジャンボ|豆つぶ|パック", s):
        return "jumbo"
    if "ペースト" in s:
        return "paste"
    if "展着" in s:
        return "sti"
    return "etc"


def nfkc(s):
    # 半角カナ・全角英数のゆれをアプリ検索側と揃えるためNFKC正規化
    return unicodedata.normalize("NFKC", s or "")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "chemdb-updater"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def find_base_zip_url():
    """index2.htm から基本部CSV(zip)のURLを探す。先頭のdatacsv/*.zipが基本部。"""
    html = fetch(INDEX_URL).decode("shift_jis", errors="replace")
    links = re.findall(r'href="(datacsv/[^"]+\.zip)"', html, re.IGNORECASE)
    if not links:
        raise SystemExit("基本部CSVのリンクが見つかりませんでした。ページ構成が変わった可能性があります。")
    return BASE_URL + links[0]


def main():
    url = find_base_zip_url()
    print("ダウンロード:", url)
    zbytes = fetch(url)
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    csv_name = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
    if not csv_name:
        raise SystemExit("zip内にCSVが見つかりませんでした。")
    raw = zf.read(csv_name).decode("cp932", errors="replace")

    reader = csv.reader(io.StringIO(raw))
    header = next(reader, None)  # 登録番号,農薬の種類,農薬の名称,...,用途,剤型名,登録年月日
    rows = []
    for c in reader:
        if len(c) < 11:
            continue
        rows.append({
            "n": c[0],
            "nm": nfkc(c[2]),
            "u": USE_MAP.get(c[8], "other"),
            "f": form_key(c[9]),
            "ig": nfkc(c[4]),
            "mk": nfkc(c[3]),
        })

    out = os.path.normpath(OUT_PATH)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print("書き出し:", out)
    print("件数:", len(rows), " サイズ:", os.path.getsize(out), "bytes")
    print("※ sw.js の CACHE_VERSION を上げてから配布してください(更新をキャッシュに反映させるため)。")


if __name__ == "__main__":
    sys.exit(main())
